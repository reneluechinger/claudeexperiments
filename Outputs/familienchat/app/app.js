const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { CONFIG } from './config.js';
import * as E2E from './crypto.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PAGE_SIZE = 50;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let sb;
const state = {
  user: null,
  me: null,
  identity: null,
  members: new Map(), // user_id → { ...row, key: CryptoKey }
  reads: new Map(), // user_id → last_read_at (ISO)
  entries: new Map(), // message id → { row, payload, error, pending, el }
  channel: null,
  hasOlder: false,
  media: new Map(), // message id → Object-URL
};

// ───────────────────────── Allgemeine Helfer ─────────────────────────

function show(name) {
  for (const s of $$('.screen')) s.hidden = s.id !== 'screen-' + name;
}

function setError(root, msg) {
  const el = $('[data-error]', root);
  if (el) el.textContent = msg || '';
}

function toast(msg, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

function friendly(err) {
  const m = err?.message || String(err);
  if (/Invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/already registered/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.';
  if (/Password should be/i.test(m)) return 'Das Passwort ist zu kurz (mindestens 8 Zeichen).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Keine Verbindung. Bitte prüfe das Internet.';
  if (/rate limit/i.test(m)) return 'Zu viele Versuche. Bitte warte kurz.';
  return m;
}

async function busy(button, fn) {
  const label = button?.textContent;
  if (button) { button.disabled = true; button.textContent = '…'; }
  try { return await fn(); }
  finally { if (button) { button.disabled = false; button.textContent = label; } }
}

// Zeitstempel in Millisekunden. Kommt mit allen Formaten von Supabase klar (auch Mikrosekunden).
function T(iso) {
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(iso ?? '');
  if (!m) return Date.parse(iso) || 0;
  const frac = ((m[3] ?? '') + '000000').slice(0, 6);
  let tz = m[4] ?? 'Z';
  if (/^[+-]\d\d$/.test(tz)) tz += ':00';
  else if (/^[+-]\d{4}$/.test(tz)) tz = tz.slice(0, 3) + ':' + tz.slice(3);
  return Date.parse(`${m[1]}T${m[2]}.${frac.slice(0, 3)}${tz}`) + Number(frac.slice(3)) / 1000;
}

const fmtTime = (iso) => new Date(T(iso)).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

function dayLabel(iso) {
  const d = new Date(T(iso));
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Heute';
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index));
    const a = document.createElement('a');
    a.href = m[0];
    a.textContent = m[0];
    a.target = '_blank';
    a.rel = 'noopener';
    frag.append(a);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

// Kleine Schlüsselablage im Browser (IndexedDB). Der private Schlüssel verlässt das Gerät nie.
const keystore = {
  db() {
    return (this._db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('familienchat', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  },
  async run(mode, fn) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', mode);
      const req = fn(tx.objectStore('keys'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  get: (id) => keystore.run('readonly', (s) => s.get(id)),
  put: (id, identity) => keystore.run('readwrite', (s) => s.put(identity, id)),
};

// Pending-Daten einer Registrierung, falls die E-Mail erst bestätigt werden muss
const pending = {
  get: () => { try { return JSON.parse(localStorage.getItem('fc-pending') || 'null'); } catch { return null; } },
  set: (v) => { try { v ? localStorage.setItem('fc-pending', JSON.stringify(v)) : localStorage.removeItem('fc-pending'); } catch {} },
};

// ───────────────────────── Start und Navigation ─────────────────────────

async function boot() {
  for (const el of $$('.app-name')) el.textContent = CONFIG.APP_NAME;
  document.title = CONFIG.APP_NAME;

  // Bildschirmhöhe an Tastatur anpassen (vor allem iPhone)
  const fit = () => document.documentElement.style.setProperty('--app-h', (visualViewport?.height ?? innerHeight) + 'px');
  visualViewport?.addEventListener('resize', fit);
  fit();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});

  if (!CONFIG.SUPABASE_URL.startsWith('https://') || CONFIG.SUPABASE_URL.includes('DEIN-PROJEKT')) return show('config');

  let createClient;
  try {
    ({ createClient } = await import(SUPABASE_JS));
  } catch {
    $('#screen-loading p').textContent = 'Keine Verbindung. Bitte prüfe das Internet und öffne die App erneut.';
    addEventListener('online', () => location.reload(), { once: true });
    return;
  }

  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  sb.auth.onAuthStateChange((event) => {
    // Keine Supabase-Aufrufe direkt im Callback, sonst blockiert die Bibliothek
    if (event === 'PASSWORD_RECOVERY') setTimeout(() => show('newpw'));
    if (event === 'SIGNED_OUT') setTimeout(() => { stopChat(); show('auth'); });
  });

  wireUi();

  if (isIOS && !isStandalone && !sessionStorage.getItem('fc-ios-ok')) return show('ios');
  await route();
}

async function route() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return show('auth');
    state.user = session.user;

    const { data: me, error } = await sb.from('members').select('*').eq('user_id', state.user.id).maybeSingle();
    if (error) throw error;
    if (!me) {
      const p = pending.get();
      if (p) { $('#form-join').code.value = p.code || ''; $('#form-join').elements.name.value = p.name || ''; }
      return show('join');
    }
    state.me = me;

    state.identity = await keystore.get(state.user.id);
    if (!state.identity || (await E2E.exportPublicKey(state.identity.publicKey)) !== me.public_key) return show('key');

    await startChat();
  } catch (err) {
    console.error(err);
    show('auth');
    setError($('#screen-auth'), friendly(err));
  }
}

// Schlüssel für dieses Konto auf dem Gerät holen oder neu erstellen
async function ensureIdentity(userId) {
  let identity = await keystore.get(userId);
  if (!identity) {
    identity = await E2E.generateIdentity();
    await keystore.put(userId, identity);
  }
  return identity;
}

async function joinWithCode(code, name) {
  const identity = await ensureIdentity(state.user.id);
  const publicKey = await E2E.exportPublicKey(identity.publicKey);
  const { error } = await sb.rpc('redeem_invite', { p_code: code, p_name: name, p_public_key: publicKey });
  if (error) throw error;
  pending.set(null);
}

async function logout() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {}
  $('#settings').close();
  await sb.auth.signOut();
}

// ───────────────────────── Bedienelemente ─────────────────────────

function wireUi() {
  $('#ios-continue').onclick = () => { sessionStorage.setItem('fc-ios-ok', '1'); route(); };

  // Tabs Anmelden / Registrieren
  for (const tab of $$('#screen-auth [data-tab]')) {
    tab.onclick = () => {
      for (const t of $$('#screen-auth [data-tab]')) t.classList.toggle('active', t === tab);
      for (const p of $$('#screen-auth [data-panel]')) p.hidden = p.dataset.panel !== tab.dataset.tab;
      setError($('#screen-auth'), '');
    };
  }

  $('#form-login').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    setError($('#screen-auth'), '');
    await busy($('button[type=submit]', f), async () => {
      const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      if (error) return setError($('#screen-auth'), friendly(error));
      await route();
    });
  };

  $('#btn-forgot').onclick = async () => {
    const email = $('#form-login').email.value.trim();
    if (!email) return setError($('#screen-auth'), 'Gib zuerst deine E-Mail ein.');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    setError($('#screen-auth'), error ? friendly(error) : '');
    if (!error) $('#screen-auth [data-info]').textContent = 'Falls das Konto existiert, kommt gleich eine E-Mail mit einem Link.';
  };

  $('#form-register').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const root = $('#screen-auth');
    setError(root, '');
    await busy($('button[type=submit]', f), async () => {
      const code = f.code.value.trim();
      const name = f.elements.name.value.trim();
      pending.set({ code, name });
      const { data, error } = await sb.auth.signUp({ email: f.email.value.trim(), password: f.password.value });
      if (error) return setError(root, friendly(error));
      if (!data.session) {
        $('[data-info]', root).textContent = 'Bestätige zuerst deine E-Mail-Adresse über den Link in deinem Postfach. Melde dich danach hier an.';
        return;
      }
      state.user = data.session.user;
      try {
        await joinWithCode(code, name);
      } catch (err) {
        await route(); // zeigt «Einladung einlösen» mit der Fehlermeldung
        setError($('#screen-join'), friendly(err));
        return;
      }
      await route();
    });
  };

  $('#form-newpw').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: e.target.password.value });
    if (error) return setError(e.target, friendly(error));
    history.replaceState(null, '', location.pathname);
    toast('Passwort gespeichert');
    await route();
  };

  $('#form-join').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    setError(f, '');
    await busy($('button[type=submit]', f), async () => {
      try {
        await joinWithCode(f.code.value.trim(), f.elements.name.value.trim());
        await route();
      } catch (err) {
        setError(f, friendly(err));
      }
    });
  };

  for (const b of $$('[data-logout]')) b.onclick = logout;

  // Schlüssel wiederherstellen oder neu erstellen
  $('#form-restore').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const root = $('#screen-key');
    setError(root, '');
    await busy($('button[type=submit]', f), async () => {
      try {
        const backup = JSON.parse(await f.file.files[0].text());
        const identity = await E2E.importBackup(backup, f.password.value);
        const pub = await E2E.exportPublicKey(identity.publicKey);
        if (pub !== state.me.public_key) {
          const ok = confirm('Diese Sicherung ist älter als dein aktueller Schlüssel. Nachrichten, die mit dem neueren Schlüssel verschickt wurden, kannst du dann nicht lesen. Trotzdem verwenden?');
          if (!ok) return;
          const { error } = await sb.from('members').update({ public_key: pub }).eq('user_id', state.user.id);
          if (error) throw error;
        }
        await keystore.put(state.user.id, identity);
        await route();
      } catch (err) {
        setError(root, friendly(err));
      }
    });
  };

  $('#btn-newkey').onclick = async (e) => {
    if (!confirm('Wirklich einen neuen Schlüssel erstellen? Alte Nachrichten sind auf diesem Gerät dann nicht mehr lesbar.')) return;
    const root = $('#screen-key');
    await busy(e.target, async () => {
      try {
        const identity = await E2E.generateIdentity();
        const pub = await E2E.exportPublicKey(identity.publicKey);
        const { error } = await sb.from('members').update({ public_key: pub }).eq('user_id', state.user.id);
        if (error) throw error;
        await keystore.put(state.user.id, identity);
        await route();
      } catch (err) {
        setError(root, friendly(err));
      }
    });
  };

  // Chat-Eingabe
  const input = $('#input-text');
  const syncComposer = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    const hasText = input.value.trim().length > 0;
    $('#btn-send').hidden = !hasText;
    $('#btn-mic').hidden = hasText || !canRecord();
  };
  input.addEventListener('input', syncComposer);
  input.addEventListener('keydown', (e) => {
    // Enter sendet am Computer, Shift+Enter macht eine neue Zeile. Am Handy bleibt Enter ein Zeilenumbruch.
    if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    syncComposer();
    input.focus();
    sendMessage({ type: 'text', text });
  };
  syncComposer();

  $('#file-image').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) sendImage(file);
  };

  $('#btn-mic').onclick = startRecording;
  $('#btn-rec-cancel').onclick = () => stopRecording(false);
  $('#btn-rec-send').onclick = () => stopRecording(true);

  $('#btn-older').onclick = loadOlder;

  // Einstellungen
  $('#btn-menu').onclick = openSettings;
  for (const d of $$('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  $('#btn-push').onclick = (e) => busy(e.target, enablePush);
  $('#btn-push-banner').onclick = (e) => busy(e.target, enablePush);
  $('#btn-push-dismiss').onclick = () => { localStorage.setItem('fc-push-dismissed', '1'); $('#push-banner').hidden = true; };

  $('#form-name').onsubmit = async (e) => {
    e.preventDefault();
    const name = e.target.elements.name.value.trim();
    const { error } = await sb.from('members').update({ display_name: name }).eq('user_id', state.user.id);
    if (error) return setError($('#settings'), friendly(error));
    toast('Name gespeichert');
  };

  $('#btn-invite').onclick = (e) => busy(e.target, createInvite);
  $('#btn-invite-share').onclick = shareInvite;

  $('#form-backup').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.pw1.value !== f.pw2.value) return setError($('#settings'), 'Die Passwörter stimmen nicht überein.');
    await busy($('button[type=submit]', f), async () => {
      const backup = await E2E.exportBackup(state.identity, f.pw1.value);
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const name = `${CONFIG.APP_NAME}-Schluessel-${state.me.display_name}.json`.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_');
      const file = new File([blob], name, { type: 'application/json' });
      if (isIOS && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] }).catch(() => {});
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      f.reset();
      setError($('#settings'), '');
      toast('Sicherung erstellt. Bewahre Datei und Passwort gut auf.', 5000);
    });
  };

  // Bild gross anzeigen
  $('#msg-list').addEventListener('click', (e) => {
    const img = e.target.closest('img.photo');
    if (!img) return;
    $('#viewer img').src = img.src;
    $('#viewer').showModal();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.channel) {
      catchUp();
      markRead();
      clearNotifications();
    }
  });
  addEventListener('online', () => state.channel && catchUp());
}

// ───────────────────────── Chat ─────────────────────────

async function startChat() {
  stopChat();
  show('chat');

  await Promise.all([loadMembers(), loadReads()]);

  const { data: rows, error } = await sb.from('messages').select('*').order('created_at', { ascending: false }).limit(PAGE_SIZE);
  if (error) return toast(friendly(error));
  state.hasOlder = rows.length === PAGE_SIZE;
  $('#btn-older').hidden = !state.hasOlder;
  await Promise.all(rows.reverse().map((r) => addEntry(r)));
  scrollToBottom(true);
  markRead();
  clearNotifications();
  subscribe();
  updatePushBanner();
}

function stopChat() {
  if (state.channel) sb.removeChannel(state.channel);
  state.channel = null;
  state.entries.clear();
  for (const url of state.media.values()) URL.revokeObjectURL(url);
  state.media.clear();
  state.members.clear();
  $('#msg-list').replaceChildren();
}

async function loadMembers() {
  const { data, error } = await sb.from('members').select('*').order('joined_at');
  if (error) return toast(friendly(error));
  state.members.clear();
  for (const m of data) {
    try {
      state.members.set(m.user_id, { ...m, key: await E2E.importPublicKey(m.public_key) });
    } catch {
      state.members.set(m.user_id, { ...m, key: null });
    }
  }
  const mine = data.find((m) => m.user_id === state.user.id);
  if (mine) state.me = mine;
  const others = data.filter((m) => m.user_id !== state.user.id).map((m) => m.display_name);
  $('#chat-sub').textContent = others.length ? 'mit ' + others.join(', ') : 'Noch niemand sonst da. Lade jemanden ein!';
  $('#screen-chat').classList.toggle('group', data.length > 2);
  refreshAllMeta();
}

async function loadReads() {
  const { data } = await sb.from('read_state').select('*');
  for (const r of data ?? []) state.reads.set(r.user_id, r.last_read_at);
}

function subscribe() {
  state.channel = sb
    .channel('chat')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
      const nearBottom = isNearBottom();
      addEntry(row).then(() => {
        if (nearBottom || row.sender_id === state.user.id) scrollToBottom();
        markRead();
      });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'read_state' }, ({ new: row }) => {
      if (!row?.user_id) return;
      state.reads.set(row.user_id, row.last_read_at);
      refreshAllMeta();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => loadMembers())
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') catchUp();
    });
}

// Nachrichten holen, die während einer Verbindungspause gekommen sind
async function catchUp() {
  const last = [...state.entries.values()].filter((e) => !e.pending).map((e) => e.row.created_at).reduce((a, b) => (T(b) > T(a) ? b : a), null);
  let q = sb.from('messages').select('*').order('created_at', { ascending: true }).limit(200);
  if (last) q = q.gt('created_at', last);
  const { data } = await q;
  if (!data?.length) return;
  const nearBottom = isNearBottom();
  await Promise.all(data.map((r) => addEntry(r)));
  loadReads().then(refreshAllMeta);
  if (nearBottom) scrollToBottom();
  markRead();
}

async function loadOlder() {
  const oldest = [...state.entries.values()].filter((e) => !e.pending).map((e) => e.row.created_at).reduce((a, b) => (!a || T(b) < T(a) ? b : a), null);
  if (!oldest) return;
  const { data, error } = await sb.from('messages').select('*').lt('created_at', oldest).order('created_at', { ascending: false }).limit(PAGE_SIZE);
  if (error) return toast(friendly(error));
  state.hasOlder = data.length === PAGE_SIZE;
  $('#btn-older').hidden = !state.hasOlder;
  const box = $('#messages');
  const before = box.scrollHeight;
  await Promise.all(data.map((r) => addEntry(r)));
  box.scrollTop += box.scrollHeight - before;
}

function isNearBottom() {
  const box = $('#messages');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}

function scrollToBottom(instant) {
  const box = $('#messages');
  requestAnimationFrame(() => box.scrollTo({ top: box.scrollHeight, behavior: instant ? 'instant' : 'smooth' }));
}

// Eintrag anlegen oder aktualisieren, entschlüsseln und an der richtigen Stelle einsortieren
async function addEntry(row, { pending = false, payload = null } = {}) {
  let entry = state.entries.get(row.id);
  if (entry) {
    if (entry.pending && !pending) {
      entry.pending = false;
      entry.row = row;
      placeEntry(entry);
      refreshMeta(entry);
    }
    return entry;
  }
  entry = { row, payload, error: null, pending, el: document.createElement('div') };
  entry.el.className = 'msg' + (row.sender_id === state.user.id ? ' mine' : '');
  entry.el.dataset.id = row.id;
  state.entries.set(row.id, entry);

  if (!payload) {
    try {
      const key = await E2E.openMessageKey(state.identity.privateKey, state.user.id, row.eph_pub, row.keys);
      entry.key = key;
      entry.payload = await E2E.decryptJson(key, row.iv, row.body);
    } catch (err) {
      entry.error = err;
    }
  }
  renderEntry(entry);
  placeEntry(entry);
  return entry;
}

function placeEntry(entry) {
  const list = $('#msg-list');
  const t = T(entry.row.created_at);
  const after = [...list.children].find((el) => {
    const other = state.entries.get(el.dataset.id);
    return other && other !== entry && T(other.row.created_at) > t;
  });
  list.insertBefore(entry.el, after ?? null);
  refreshGrouping();
}

// Datumstrenner und Absendernamen nur dort, wo sie nötig sind
function refreshGrouping() {
  let prevDay = null;
  let prevSender = null;
  for (const el of $('#msg-list').children) {
    const e = state.entries.get(el.dataset.id);
    if (!e) continue;
    const day = new Date(T(e.row.created_at)).toDateString();
    const newDay = day !== prevDay;
    el.classList.toggle('day-start', newDay);
    el.dataset.day = newDay ? dayLabel(e.row.created_at) : '';
    el.classList.toggle('first', newDay || e.row.sender_id !== prevSender);
    prevDay = day;
    prevSender = e.row.sender_id;
  }
}

function renderEntry(entry) {
  const { row, payload } = entry;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const sender = document.createElement('div');
  sender.className = 'sender';
  sender.textContent = state.members.get(row.sender_id)?.display_name ?? 'Ehemaliges Mitglied';
  bubble.append(sender);

  const content = document.createElement('div');
  content.className = 'content';
  if (entry.error || !payload) {
    content.classList.add('locked');
    content.textContent = '🔒 Diese Nachricht lässt sich auf diesem Gerät nicht entschlüsseln.';
  } else if (payload.type === 'text') {
    content.append(linkify(payload.text));
    if (/^\p{Extended_Pictographic}{1,3}$/u.test(payload.text.replace(/\s|️|‍/g, ''))) bubble.classList.add('emoji');
  } else if (payload.type === 'image') {
    const img = document.createElement('img');
    img.className = 'photo';
    img.alt = 'Bild';
    if (payload.w && payload.h) img.style.aspectRatio = `${payload.w} / ${payload.h}`;
    content.append(img);
    loadMedia(entry).then((url) => { if (url) img.src = url; });
  } else if (payload.type === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    content.append(audio);
    loadMedia(entry).then((url) => { if (url) audio.src = url; });
  }
  bubble.append(content);

  const meta = document.createElement('div');
  meta.className = 'meta';
  bubble.append(meta);

  entry.el.replaceChildren(bubble);
  refreshMeta(entry);
}

// Uhrzeit und Häkchen
function refreshMeta(entry) {
  const meta = $('.meta', entry.el);
  if (!meta) return;
  const time = fmtTime(entry.row.created_at);
  if (entry.row.sender_id !== state.user.id) {
    meta.textContent = time;
    return;
  }
  let tick = '🕓';
  let cls = 'tick';
  let title = 'Wird gesendet';
  if (entry.failed) {
    tick = '⚠️';
    title = 'Nicht gesendet';
  } else if (!entry.pending) {
    const others = [...state.members.keys()].filter((id) => id !== state.user.id);
    const readers = others.filter((id) => T(state.reads.get(id)) >= T(entry.row.created_at));
    const allRead = others.length > 0 && readers.length === others.length;
    tick = allRead ? '✓✓' : '✓';
    cls += allRead ? ' read' : '';
    title = readers.length ? 'Gelesen von ' + readers.map((id) => state.members.get(id)?.display_name).join(', ') : 'Gesendet';
  }
  meta.innerHTML = '';
  meta.append(time + ' ');
  const t = document.createElement('span');
  t.className = cls;
  t.textContent = tick;
  t.title = title;
  meta.append(t);
}

function refreshAllMeta() {
  for (const e of state.entries.values()) {
    const sender = $('.sender', e.el);
    if (sender) sender.textContent = state.members.get(e.row.sender_id)?.display_name ?? 'Ehemaliges Mitglied';
    refreshMeta(e);
  }
}

// Eigenen Lesestand melden, sobald der Chat sichtbar ist
let markTimer;
function markRead() {
  clearTimeout(markTimer);
  markTimer = setTimeout(async () => {
    if (document.visibilityState !== 'visible' || !state.channel) return;
    const latest = [...state.entries.values()]
      .filter((e) => !e.pending && e.row.sender_id !== state.user.id)
      .map((e) => e.row.created_at)
      .reduce((a, b) => (T(b) > T(a) ? b : a), null);
    if (!latest || T(latest) <= T(state.reads.get(state.user.id))) return;
    state.reads.set(state.user.id, latest);
    await sb.from('read_state').upsert({ user_id: state.user.id, last_read_at: latest });
  }, 400);
}

// ───────────────────────── Senden ─────────────────────────

function recipients() {
  return [...state.members.values()].filter((m) => m.key).map((m) => ({ id: m.user_id, publicKey: m.key }));
}

async function sendMessage(payload, file) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const draft = { id, sender_id: state.user.id, created_at: now };
  let entry;
  try {
    const { key, ephPub, keys } = await E2E.createMessageKey(recipients());
    entry = await addEntry(draft, { pending: true, payload });
    entry.key = key;
    if (file) state.media.set(id, URL.createObjectURL(new Blob([file.bytes], { type: file.mime })));
    renderEntry(entry);
    scrollToBottom();

    if (file) {
      const encrypted = await E2E.encryptBytes(key, file.bytes);
      const path = `${id}.bin`;
      const { error: upErr } = await sb.storage.from('media').upload(path, encrypted.data, { contentType: 'application/octet-stream' });
      if (upErr) throw upErr;
      payload = { ...payload, file: { path, iv: encrypted.iv, mime: file.mime, size: file.bytes.length } };
      entry.payload = payload;
    }

    const { iv, body } = await E2E.encryptJson(key, payload);
    const { data: row, error } = await sb.from('messages').insert({ id, eph_pub: ephPub, iv, body, keys }).select().single();
    if (error) throw error;
    await addEntry(row);
    notifyOthers();
  } catch (err) {
    console.error(err);
    if (entry) { entry.failed = true; refreshMeta(entry); }
    toast('Senden fehlgeschlagen: ' + friendly(err), 5000);
  }
}

function notifyOthers() {
  sb.functions.invoke('notify', { body: { action: 'notify', title: CONFIG.APP_NAME } }).catch(() => {});
}

async function loadMedia(entry) {
  if (state.media.has(entry.row.id)) return state.media.get(entry.row.id);
  const f = entry.payload?.file;
  if (!f || !entry.key) return null;
  try {
    const { data, error } = await sb.storage.from('media').download(f.path);
    if (error) throw error;
    const bytes = await E2E.decryptBytes(entry.key, f.iv, await data.arrayBuffer());
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    state.media.set(entry.row.id, url);
    return url;
  } catch (err) {
    console.error(err);
    $('.content', entry.el)?.append(Object.assign(document.createElement('div'), { className: 'muted small', textContent: 'Datei konnte nicht geladen werden' }));
    return null;
  }
}

// Bilder verkleinern (spart Speicher und Datenvolumen)
async function sendImage(file) {
  try {
    let bytes, mime = 'image/jpeg', w, h;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      w = Math.round(bmp.width * scale);
      h = Math.round(bmp.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparente Stellen weiss statt schwarz
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch {
      bytes = new Uint8Array(await file.arrayBuffer());
      mime = file.type || 'image/jpeg';
    }
    if (bytes.length > 19 * 1024 * 1024) return toast('Das Bild ist zu gross (max. 19 MB).');
    await sendMessage({ type: 'image', w, h }, { bytes, mime });
  } catch (err) {
    toast('Bild konnte nicht gesendet werden: ' + friendly(err));
  }
}

// ───────────────────────── Sprachnachrichten ─────────────────────────

const rec = { recorder: null, chunks: [], start: 0, timer: null, stream: null };

function canRecord() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function pickAudioType() {
  // MP4/AAC spielen iPhone und Android beide ab. WebM als Ausweichlösung.
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

async function startRecording() {
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast('Kein Zugriff aufs Mikrofon. Bitte in den Einstellungen erlauben.', 5000);
  }
  const mimeType = pickAudioType();
  rec.recorder = new MediaRecorder(rec.stream, mimeType ? { mimeType } : undefined);
  rec.chunks = [];
  rec.recorder.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
  rec.recorder.start(250);
  rec.start = Date.now();
  $('#recorder').hidden = false;
  $('#composer').hidden = true;
  const tick = () => {
    const s = Math.floor((Date.now() - rec.start) / 1000);
    $('#rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s >= 300) stopRecording(true); // höchstens 5 Minuten
  };
  tick();
  rec.timer = setInterval(tick, 500);
}

function stopRecording(send) {
  if (!rec.recorder) return;
  clearInterval(rec.timer);
  const recorder = rec.recorder;
  rec.recorder = null;
  recorder.onstop = async () => {
    rec.stream.getTracks().forEach((t) => t.stop());
    $('#recorder').hidden = true;
    $('#composer').hidden = false;
    const duration = Math.round((Date.now() - rec.start) / 1000);
    if (!send || duration < 1) return;
    const mime = (recorder.mimeType || rec.chunks[0]?.type || 'audio/mp4').split(';')[0];
    const bytes = new Uint8Array(await new Blob(rec.chunks).arrayBuffer());
    sendMessage({ type: 'audio', duration }, { bytes, mime });
  };
  recorder.stop();
}

// ───────────────────────── Benachrichtigungen ─────────────────────────

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlB64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

async function pushState() {
  if (!pushSupported()) return isIOS && !isStandalone ? 'ios-browser' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function updatePushBanner() {
  const s = await pushState();
  const dismissed = localStorage.getItem('fc-push-dismissed');
  $('#push-banner').hidden = s !== 'off' || !!dismissed;
}

async function enablePush() {
  try {
    if (!pushSupported()) throw new Error(isIOS ? 'Auf dem iPhone geht das nur in der App vom Home-Bildschirm.' : 'Dieser Browser unterstützt keine Benachrichtigungen.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt. Du kannst das in den Einstellungen des Handys ändern.');
    const { data, error } = await sb.functions.invoke('notify', { body: { action: 'vapid' } });
    if (error || !data?.publicKey) throw new Error('Der Benachrichtigungs-Dienst ist noch nicht eingerichtet (Edge Function «notify»).');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(data.publicKey) });
    const j = sub.toJSON();
    const { error: dbErr } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: state.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth });
    if (dbErr) throw dbErr;
    toast('Benachrichtigungen sind eingeschaltet');
  } catch (err) {
    setError($('#settings'), friendly(err));
    toast(friendly(err), 5000);
  }
  updatePushBanner();
  renderPushStatus();
}

async function renderPushStatus() {
  const s = await pushState();
  const text = {
    on: '✅ Auf diesem Gerät eingeschaltet.',
    off: 'Auf diesem Gerät ausgeschaltet.',
    denied: '⛔ Blockiert. Erlaube Benachrichtigungen in den Einstellungen des Handys bzw. Browsers.',
    'ios-browser': 'Auf dem iPhone nur in der App vom Home-Bildschirm möglich.',
    unsupported: 'Dieser Browser unterstützt keine Benachrichtigungen.',
  }[s];
  $('#push-status').textContent = text;
  $('#btn-push').hidden = s !== 'off';
}

async function clearNotifications() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const n of (await reg?.getNotifications()) ?? []) n.close();
    navigator.clearAppBadge?.();
  } catch {}
}

// ───────────────────────── Einstellungen ─────────────────────────

async function openSettings() {
  setError($('#settings'), '');
  $('#form-name').elements.name.value = state.me.display_name;
  renderPushStatus();

  const list = $('#member-list');
  list.replaceChildren();
  for (const m of state.members.values()) {
    const li = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = m.display_name + (m.user_id === state.user.id ? ' (du)' : '');
    li.append(name);
    if (m.is_admin) li.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: 'Admin' }));
    const fp = document.createElement('code');
    fp.className = 'fp';
    fp.textContent = await E2E.fingerprint(m.public_key);
    li.append(fp);
    list.append(li);
  }

  $('#invite-box').hidden = !state.me.is_admin;
  $('#invite-result').hidden = true;
  if (state.me.is_admin) renderInvites();
  $('#settings').showModal();
}

const prettyCode = (c) => c.length === 10 ? c.slice(0, 5) + '-' + c.slice(5) : c;

async function renderInvites() {
  const { data } = await sb.from('invites').select('*').is('used_by', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false });
  const ul = $('#invite-list');
  ul.replaceChildren();
  for (const inv of data ?? []) {
    const li = document.createElement('li');
    const days = Math.ceil((new Date(inv.expires_at) - Date.now()) / 864e5);
    li.append(Object.assign(document.createElement('code'), { textContent: prettyCode(inv.code) }));
    li.append(Object.assign(document.createElement('span'), { className: 'muted small grow', textContent: ` offen, noch ${days} Tag${days === 1 ? '' : 'e'}${inv.is_admin ? ', Admin' : ''}` }));
    const del = Object.assign(document.createElement('button'), { className: 'small-btn ghost', textContent: 'Löschen' });
    del.onclick = async () => {
      await sb.from('invites').delete().eq('code', inv.code);
      renderInvites();
    };
    li.append(del);
    ul.append(li);
  }
}

async function createInvite() {
  const { data, error } = await sb.rpc('create_invite', { p_is_admin: $('#invite-admin').checked });
  if (error) return setError($('#settings'), friendly(error));
  $('#invite-code').textContent = data;
  $('#invite-result').hidden = false;
  renderInvites();
}

async function shareInvite() {
  const code = $('#invite-code').textContent;
  const url = location.origin + location.pathname;
  const text = `Du bist zu «${CONFIG.APP_NAME}» eingeladen!\n\n1. Öffne ${url}\n2. iPhone: Teilen → «Zum Home-Bildschirm». Android: Menü ⋮ → «App installieren»\n3. Öffne die App und wähle «Neu mit Einladung»\n4. Dein Code: ${code}\n\nDer Code gilt 7 Tage und nur einmal.`;
  if (navigator.share) {
    await navigator.share({ text }).catch(() => {});
  } else {
    await navigator.clipboard.writeText(text);
    toast('Einladung kopiert');
  }
}

boot();
