// Supabase Edge Function «notify»
// Schickt allen anderen Mitgliedern eine Push-Benachrichtigung, wenn jemand etwas sendet.
// Der Inhalt der Nachricht bleibt verschlüsselt. Die Benachrichtigung sagt nur, von wem sie ist.
//
// Benötigte Secrets (Dashboard → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (z. B. mailto:du@example.com)
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase automatisch bereit.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
  if (!publicKey || !privateKey) return json({ error: 'VAPID-Secrets fehlen' }, 500);

  const { action, title } = await req.json().catch(() => ({}));

  // Die App fragt hier den öffentlichen Push-Schlüssel ab
  if (action === 'vapid') return json({ publicKey });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json({ error: 'Nicht angemeldet' }, 401);

  const { data: me } = await admin.from('members').select('display_name').eq('user_id', user.id).maybeSingle();
  if (!me) return json({ error: 'Kein Mitglied' }, 403);

  const { data: subs } = await admin.from('push_subscriptions').select('*').neq('user_id', user.id);

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const payload = JSON.stringify({
    title: String(title || 'Familienchat').slice(0, 40),
    body: `Neue Nachricht von ${me.display_name}`,
  });

  let sent = 0;
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'high' },
        );
        sent++;
      } catch (err) {
        // Abo existiert nicht mehr (App gelöscht, Berechtigung entzogen): aufräumen
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        else console.error('Push fehlgeschlagen', code, (err as Error).message);
      }
    }),
  );

  return json({ sent });
});
