# Cantabria Places Map

A small personal discovery/planning map for places and activities in Cantabria and the Picos de Europa. Works on desktop and iPhone (add to Home Screen). Not a navigation app: routes open in Google Maps / AllTrails / GPX apps.

Notion (`Places & Activities`) stays the source of truth. This site is a static snapshot.

## Layers

| Layer | Status |
|---|---|
| Pasaporte Cultura | 21 places (Notion currently has 21, not 19) |
| Hikes | 15 hikes that have an official GPX track; tap one to draw its route. Hikes without a track stay off the map until they get one |
| Family (4), Easy walks (3), Places & day trips (2) | from data/other.json; Resources are left off the map |

Empty layers are hidden automatically.

## Data pipeline

```
data/cultura.notion.json   snapshot of Notion rows
data/coords.json           reviewed coordinates (never guessed)
        └─ npm run data ─▶ public/data/places.json
```

`locationStatus` is `verified`, `approximate` or `unverified`. A row without an entry in `coords.json` is not put on the map.
`scripts/geocode.mjs "query"` prints OpenStreetMap candidates to review by hand.

Hike records use the same file with `category: "hike"` and a `hike` object
(`distanceKm, ascentM, duration, difficulty, stage, routeType, childSuitability, conditions, exposure, trailhead, parking, plannedVersion, officialUrl, allTrailsUrl, gpxUrl, routeGeometry, trackSource`).
`routeGeometry: "Full track"` only when a usable GPX/geometry URL is actually held.

## Hike routes

`data/gpx/<hike-id>/track.gpx` (raw tracks) + `data/gpx/sources.json` --`node scripts/build-routes.mjs`--> `public/routes/<hike-id>.json` (simplified line, a few KB each).
`node scripts/build-data.mjs` only publishes a hike when its route file exists (`HIKES_NEED_ROUTE=0` publishes every placed hike).
To add a route: put the GPX in `data/gpx/<hike-id>/`, add an entry to `sources.json`, run both scripts. Ruta del Cares still needs its official IGN/CNIG file
(the download sits behind a CAPTCHA, so save it from a browser). Naturea tracks are the 14 self-guided CA-ENP routes plus Urdón-Tresviso from Rutas de Asturias.

## Hosting

Live at https://explorecantabria.fyi, served by Hostinger (shared plan, free Let's Encrypt certificate, HTTP redirects to HTTPS).
DNS stays at Cloudflare as two **DNS-only** (grey cloud) A records pointing at Hostinger. Keep them DNS-only: Spanish ISPs block
Cloudflare's shared proxy addresses during LaLiga match windows, which made the earlier Cloudflare Workers version unreachable at weekends.

The app also keeps an offline copy (service worker, `public/sw.js`) so it opens when offline or blocked.

## Develop / deploy

```sh
npm install
npm run dev      # local preview at http://localhost:8787 (wrangler dev)
```

Deploy = upload the contents of `public/` to the Hostinger site's `public_html` (archive upload via the Hostinger connector,
or hPanel File Manager). `public/.htaccess` sets the noindex header and the manifest type. No Cloudflare Worker is used any more.
