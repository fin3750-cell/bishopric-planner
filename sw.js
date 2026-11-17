// Network first, cache as the offline fallback, for the app's own files only.
// Google sign-in and Sheets requests are never cached, so member data is not stored by this worker.
const CACHE = 'planner-v0.9.1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest',
  './js/auth.js', './js/dates.js', './js/members.js', './js/settings.js', './js/sheets.js', './js/store.js', './js/ui.js',
  './js/features/index.js', './js/features/speakers.js', './js/features/speakers-logic.js',
  './js/features/callings.js', './js/features/callings-logic.js', './js/features/callings-orgs.js',
  './js/features/callings-orgchart.js', './js/features/callings-lcr.js', './js/features/callings-import.js',
  './js/features/calendar.js', './js/features/calendar-logic.js', './js/features/stake-parse.js',
  './js/views/members.js', './js/views/import.js', './js/views/settings.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
