// Service Worker: macht die App installierbar, startet schneller und zeigt Push-Benachrichtigungen.
// Bei jeder Änderung an der App die Versionsnummer erhöhen, damit alle Geräte das Update holen.
const VERSION = 'v1';
const CACHE = 'familienchat-' + VERSION;
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'crypto.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Eigene Dateien: zuerst Netz (immer aktuell), ohne Netz aus dem Zwischenspeicher
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Familienchat', {
      body: data.body || 'Neue Nachricht',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: 'familienchat',
      renotify: true,
      data: { url: './' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(event.notification.data?.url || './');
    }),
  );
});
