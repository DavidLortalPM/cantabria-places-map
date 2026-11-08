// Offline copy of the app, but online always wins.
// - App code, page and data (html, js, css, json, manifest): network first, so every load pulls the latest version.
//   If the network is slow (> NET_TIMEOUT_MS), fails, or the site is blocked by an ISP (e.g. LaLiga match windows
//   in Spain), the saved copy is used instead, so the map still opens. A slow request keeps going and refreshes the copy.
// - Libraries and icons: cache first. Photos: cached as you view them. Map tiles: cached as you view them (capped).
const VERSION = 'v5';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 600;
const NET_TIMEOUT_MS = 3500;

const PRECACHE = [
  '/', '/app.js', '/style.css', '/manifest.webmanifest', '/icon-180.png', '/data/places.json',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/images/layers.png', '/vendor/leaflet/images/layers-2x.png',
  '/vendor/leaflet/images/marker-icon.png', '/vendor/leaflet/images/marker-icon-2x.png', '/vendor/leaflet/images/marker-shadow.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(PRECACHE);
    try { // hike routes are tiny: keep them all for offline use
      const idx = await (await fetch('/routes/index.json', { cache: 'no-cache' })).json();
      await c.addAll(['/routes/index.json', ...Object.keys(idx).map(id => '/routes/' + id + '.json')]);
    } catch { /* no routes yet */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME, TILES]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first with a time limit; falls back to the saved copy. `key` is what the copy is stored under.
async function networkFirst(url, key) {
  const cache = await caches.open(SHELL);
  const fresh = fetch(url, { cache: 'no-cache' }).then(res => {
    if (res && res.ok) cache.put(key, res.clone());
    return res;
  });
  fresh.catch(() => {}); // a late failure must not surface as an unhandled rejection
  try {
    const res = await Promise.race([fresh, new Promise(r => setTimeout(() => r(null), NET_TIMEOUT_MS))]);
    if (res && res.ok) return res;
  } catch { /* network error: use the saved copy */ }
  return (await cache.match(key, { ignoreSearch: true })) || fresh.catch(() => Response.error());
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
    }
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (/(^|\.)tile\.(openstreetmap|opentopomap)\.org$/.test(url.hostname)) {
    e.respondWith(tile(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') { // the page itself
    e.respondWith(networkFirst('/', '/'));
    return;
  }
  if (url.pathname.startsWith('/img/')) { e.respondWith(cacheFirst(req, RUNTIME)); return; }
  if (url.pathname.startsWith('/vendor/') || /\.(png|ico)$/.test(url.pathname)) { e.respondWith(cacheFirst(req, SHELL)); return; }
  e.respondWith(networkFirst(req.url, url.pathname)); // app.js, style.css, data, routes, manifest
});
