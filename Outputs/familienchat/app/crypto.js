// Ende-zu-Ende-Verschlüsselung mit der eingebauten Web Crypto API.
//
// Jede Person hat ein Schlüsselpaar (ECDH P-256). Der private Teil bleibt auf dem Gerät.
// Pro Nachricht entsteht ein zufälliger AES-Schlüssel. Er verschlüsselt den Inhalt und
// wird danach für jedes Mitglied einzeln verpackt (ECDH mit Einmal-Schlüssel + HKDF + AES-GCM).

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  from(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  to(str) {
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  },
};

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const randomIv = () => globalThis.crypto.getRandomValues(new Uint8Array(12));

export async function generateIdentity() {
  return subtle.generateKey(ECDH, true, ['deriveBits']);
}

export async function exportPublicKey(publicKey) {
  return b64.from(await subtle.exportKey('raw', publicKey));
}

export async function importPublicKey(str) {
  return subtle.importKey('raw', b64.to(str), ECDH, true, []);
}

// Kurze Sicherheitsnummer zum Vergleichen von Angesicht zu Angesicht.
export async function fingerprint(publicKeyB64) {
  const hash = new Uint8Array(await subtle.digest('SHA-256', b64.to(publicKeyB64)));
  const hex = Array.from(hash.subarray(0, 10), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{4}/g).join(' ');
}

async function wrappingKey(privateKey, publicKey, salt, info) {
  const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('familienchat/v1/' + info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Erstellt einen neuen Nachrichtenschlüssel und verpackt ihn für alle Empfänger.
// recipients: [{ id, publicKey: CryptoKey }]
export async function createMessageKey(recipients) {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const raw = await subtle.exportKey('raw', key);
  const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const ephRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const keys = {};
  for (const r of recipients) {
    const wk = await wrappingKey(eph.privateKey, r.publicKey, ephRaw, r.id);
    const iv = randomIv();
    keys[r.id] = { iv: b64.from(iv), k: b64.from(await subtle.encrypt({ name: 'AES-GCM', iv }, wk, raw)) };
  }
  return { key, ephPub: b64.from(ephRaw), keys };
}

// Packt den Nachrichtenschlüssel mit dem eigenen privaten Schlüssel wieder aus.
export async function openMessageKey(privateKey, myId, ephPub, keys) {
  const entry = keys?.[myId];
  if (!entry) throw new Error('Nachricht nicht für dieses Konto verschlüsselt');
  const ephRaw = b64.to(ephPub);
  const ephKey = await subtle.importKey('raw', ephRaw, ECDH, false, []);
  const wk = await wrappingKey(privateKey, ephKey, ephRaw, myId);
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv: b64.to(entry.iv) }, wk, b64.to(entry.k));
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptJson(key, obj) {
  const iv = randomIv();
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64.from(iv), body: b64.from(data) };
}

export async function decryptJson(key, iv, body) {
  const data = await subtle.decrypt({ name: 'AES-GCM', iv: b64.to(iv) }, key, b64.to(body));
  return JSON.parse(dec.decode(data));
}

export async function encryptBytes(key, bytes) {
  const iv = randomIv();
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64.from(iv), data: new Uint8Array(data) };
}

export async function decryptBytes(key, iv, data) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b64.to(iv) }, key, data));
}

// ── Schlüssel-Backup mit Passwort ──

async function passwordKey(password, salt) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function exportBackup(identity, password) {
  const jwk = await subtle.exportKey('jwk', identity.privateKey);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = randomIv();
  const key = await passwordKey(password, salt);
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(jwk)));
  return { app: 'familienchat', v: 1, salt: b64.from(salt), iv: b64.from(iv), data: b64.from(data) };
}

export async function importBackup(backup, password) {
  if (backup?.app !== 'familienchat') throw new Error('Das ist keine Familienchat-Schlüsseldatei');
  const key = await passwordKey(password, b64.to(backup.salt));
  let jwk;
  try {
    jwk = JSON.parse(dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: b64.to(backup.iv) }, key, b64.to(backup.data))));
  } catch {
    throw new Error('Falsches Passwort');
  }
  const privateKey = await subtle.importKey('jwk', jwk, ECDH, true, ['deriveBits']);
  const { d, key_ops, ...pub } = jwk;
  const publicKey = await subtle.importKey('jwk', { ...pub, key_ops: [] }, ECDH, true, []);
  return { privateKey, publicKey };
}
