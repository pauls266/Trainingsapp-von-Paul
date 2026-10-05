/* Offline-Helfer (Service Worker) für das Laufbuch.
   Regel: Mit Internet wird immer zuerst die neueste Version vom Server geholt,
   die gespeicherte Kopie dient nur als Ersatz ohne Netz. So bleibt niemand auf
   einer alten Version hängen. Trainingsdaten werden hier NICHT gespeichert –
   die liegen weiterhin nur in der Datenbank im Browser.
   Die Versionsnummer muss zu APP_VERSION in core.js passen (wird getestet). */
const VERSION = '2.3.0';
const CACHE = 'laufbuch-' + VERSION;
const FILES = ['./', './index.html', './style.css', './core.js', './exercises.js', './charts.js', './map.js', './app.js', './vendor/jszip-3.10.1.min.js',
  './vendor/leaflet-1.9.4/leaflet.js', './vendor/leaflet-1.9.4/leaflet.css',
  './manifest.webmanifest', './icons/icon.svg', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const TIMEOUT = 4000; // bei sehr langsamem Netz nach 4 s auf die gespeicherte Kopie ausweichen

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('laufbuch-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function networkFirst(req){
  return caches.open(CACHE).then(cache => new Promise(resolve => {
    let done = false;
    const fallback = () => cache.match(req, {ignoreSearch: true}).then(r => r || (req.mode === 'navigate' ? cache.match('./index.html') : null));
    const timer = setTimeout(() => fallback().then(r => { if (r && !done){ done = true; resolve(r); } }), TIMEOUT);
    fetch(req).then(res => {
      clearTimeout(timer);
      if (res && res.ok) cache.put(req, res.clone());
      if (!done){ done = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fallback().then(r => { if (!done){ done = true; resolve(r || Response.error()); } });
    });
  }));
}

function cacheFirst(req){
  return caches.open(CACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  })));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (FONT_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req)); // Schriften ändern sich nie
});
