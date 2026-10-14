-- Familienchat: Datenbank-Setup für Supabase
-- Im Supabase-Dashboard unter «SQL Editor» komplett einfügen und auf «Run» klicken.
-- Das Skript lässt sich gefahrlos mehrmals ausführen.
-- Am Ende erscheint dein persönlicher Start-Code (nur beim ersten Mal).

-- ───────────────────────── Tabellen ─────────────────────────

-- Wer gehört zum Chat? Nur wer hier steht, sieht Nachrichten.
create table if not exists public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  public_key   text not null check (char_length(public_key) between 40 and 200),
  is_admin     boolean not null default false,
  joined_at    timestamptz not null default now()
);

-- Einladungscodes. Jeder Code funktioniert genau einmal und läuft nach 7 Tagen ab.
create table if not exists public.invites (
  code       text primary key,
  is_admin   boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    uuid references auth.users (id) on delete set null,
  used_at    timestamptz
);

-- Nachrichten. Der Inhalt ist Ende-zu-Ende-verschlüsselt, der Server sieht nur Zeichensalat.
--   eph_pub: einmaliger öffentlicher Schlüssel dieser Nachricht
--   iv/body: verschlüsselter Inhalt (Text, Bild- oder Audio-Infos)
--   keys:    Nachrichtenschlüssel, für jedes Mitglied einzeln verschlüsselt
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  sender_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  eph_pub    text not null,
  iv         text not null,
  body       text not null check (char_length(body) < 200000),
  keys       jsonb not null
);
create index if not exists messages_created_at_idx on public.messages (created_at desc);

-- Bis wann hat jede Person gelesen? Daraus entstehen die blauen Häkchen.
create table if not exists public.read_state (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now()
);

-- Geräte, die Push-Benachrichtigungen bekommen sollen.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Der Zeitstempel kommt immer vom Server, nie vom Gerät.
create or replace function public.set_created_at()
returns trigger language plpgsql as $$
begin
  new.created_at := now();
  return new;
end $$;

drop trigger if exists messages_set_created_at on public.messages;
create trigger messages_set_created_at
  before insert on public.messages
  for each row execute function public.set_created_at();

-- ───────────────────────── Hilfsfunktionen ─────────────────────────

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and is_admin);
$$;

-- Neuen Einladungscode erstellen (nur Admins). Liefert z. B. «7F3K9-Q2M8D».
create or replace function public.create_invite(p_is_admin boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if not public.is_admin() then
    raise exception 'Nur Admins können einladen';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites (code, is_admin, created_by) values (v_code, p_is_admin, auth.uid());
  return substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
end $$;

-- Einladungscode einlösen und Mitglied werden.
create or replace function public.redeem_invite(p_code text, p_name text, p_public_key text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_code   text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'Du bist schon Mitglied';
  end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Bitte gib einen Namen ein';
  end if;

  select * into v_invite from public.invites
   where code = v_code and used_by is null and expires_at > now()
   for update;
  if not found then
    raise exception 'Einladungscode ungültig, schon benutzt oder abgelaufen';
  end if;

  insert into public.members (user_id, display_name, public_key, is_admin)
  values (auth.uid(), left(trim(p_name), 40), p_public_key, v_invite.is_admin);

  update public.invites set used_by = auth.uid(), used_at = now() where code = v_invite.code;

  -- Start-Codes aus dem Setup gelten nur einmal. Übrige werden gelöscht.
  if v_invite.created_by is null then
    delete from public.invites where created_by is null and used_by is null;
  end if;

  insert into public.read_state (user_id) values (auth.uid()) on conflict (user_id) do nothing;
end $$;

revoke execute on function public.is_member()                       from public, anon;
revoke execute on function public.is_admin()                        from public, anon;
revoke execute on function public.create_invite(boolean)            from public, anon;
revoke execute on function public.redeem_invite(text, text, text)   from public, anon;
grant  execute on function public.is_member()                       to authenticated;
grant  execute on function public.is_admin()                        to authenticated;
grant  execute on function public.create_invite(boolean)            to authenticated;
grant  execute on function public.redeem_invite(text, text, text)   to authenticated;

-- ───────────────────────── Zugriffsregeln (Row Level Security) ─────────────────────────

alter table public.members            enable row level security;
alter table public.invites            enable row level security;
alter table public.messages           enable row level security;
alter table public.read_state         enable row level security;
alter table public.push_subscriptions enable row level security;

-- Mitglieder: sehen einander, ändern nur den eigenen Namen und Schlüssel.
drop policy if exists "members lesen"   on public.members;
drop policy if exists "members aendern" on public.members;
create policy "members lesen" on public.members
  for select to authenticated using (public.is_member());
create policy "members aendern" on public.members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.members from anon, authenticated;
grant  update (display_name, public_key) on public.members to authenticated;

-- Einladungen: nur Admins sehen und löschen sie. Erstellt werden sie über create_invite().
drop policy if exists "invites lesen"   on public.invites;
drop policy if exists "invites loeschen" on public.invites;
create policy "invites lesen" on public.invites
  for select to authenticated using (public.is_admin());
create policy "invites loeschen" on public.invites
  for delete to authenticated using (public.is_admin() and used_by is null);
revoke insert, update on public.invites from anon, authenticated;

-- Nachrichten: Mitglieder lesen alles und schreiben unter eigenem Namen.
drop policy if exists "messages lesen"     on public.messages;
drop policy if exists "messages schreiben" on public.messages;
create policy "messages lesen" on public.messages
  for select to authenticated using (public.is_member());
create policy "messages schreiben" on public.messages
  for insert to authenticated with check (public.is_member() and sender_id = auth.uid());
revoke update, delete on public.messages from anon, authenticated;

-- Lesestatus: alle Mitglieder sehen ihn, jede Person setzt nur den eigenen.
drop policy if exists "read_state lesen"    on public.read_state;
drop policy if exists "read_state anlegen"  on public.read_state;
drop policy if exists "read_state aendern"  on public.read_state;
create policy "read_state lesen" on public.read_state
  for select to authenticated using (public.is_member());
create policy "read_state anlegen" on public.read_state
  for insert to authenticated with check (user_id = auth.uid() and public.is_member());
create policy "read_state aendern" on public.read_state
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Push-Abos: jede Person verwaltet nur die eigenen Geräte.
drop policy if exists "push eigene" on public.push_subscriptions;
create policy "push eigene" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

-- ───────────────────────── Speicher für Bilder und Sprachnachrichten ─────────────────────────
-- Die Dateien sind ebenfalls verschlüsselt. Maximal 20 MB pro Datei.

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "media lesen"     on storage.objects;
drop policy if exists "media hochladen" on storage.objects;
create policy "media lesen" on storage.objects
  for select to authenticated using (bucket_id = 'media' and public.is_member());
create policy "media hochladen" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.is_member());

-- ───────────────────────── Echtzeit ─────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['messages', 'read_state', 'members'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null; -- schon eingetragen
    end;
  end loop;
end $$;

-- ───────────────────────── Start-Code ─────────────────────────
-- Nur solange noch niemand Mitglied ist, entsteht ein Admin-Code für dich.
-- Kopiere ihn aus dem Ergebnis unten. Ohne Ergebnis gibt es schon Mitglieder.

insert into public.invites (code, is_admin, expires_at)
select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), true, now() + interval '30 days'
where not exists (select 1 from public.members)
returning substr(code, 1, 5) || '-' || substr(code, 6, 5) as "Dein Start-Code";
