# Cantabria Places Map

A small personal discovery/planning map for places and activities in Cantabria and the Picos de Europa. Works on desktop and iPhone (add to Home Screen). Not a navigation app: routes open in Google Maps / AllTrails / GPX apps.

Notion (`Places & Activities`) stays the source of truth. This site is a static snapshot.

## Layers

| Layer | Status |
|---|---|
| Pasaporte Cultura | 21 places (Notion currently has 21, not 19) |
| Hikes (trailheads) | 46 of the 52 staged hikes (Hiking Stage set in Notion); 6 await a start point |
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

## Develop / deploy

```sh
npm install
npm run dev      # http://localhost:8787
npm run deploy   # Cloudflare Workers static assets, *.workers.dev
```

No D1, KV, secrets, auth or custom domain. Leaflet is vendored in `public/vendor/leaflet`.
