// Offline copy of the app. Once the map has been opened once, it keeps working with no connection
// (and when the site itself is blocked by an ISP, e.g. during LaLiga match windows in Spain).
// - App shell + data: served from cache instantly, refreshed in the background (stale-while-revalidate).
// - Photos and map tiles: cached as you view them (tiles capped so the cache stays small).
const VERSION = 'v4';
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 600;

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
      const idx = await (await fetch('/routes/index.json')).json();
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

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await net) || Response.error();
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

  if (req.mode === 'navigate') {
    e.respondWith(staleWhileRevalidate(new Request('/'), SHELL));
    return;
  }
  e.respondWith(staleWhileRevalidate(req, url.pathname.startsWith('/img/') ? RUNTIME : SHELL));
});
