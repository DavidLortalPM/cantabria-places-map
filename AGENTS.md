# AGENTS.md

> `CLAUDE.md` contains one line: `See AGENTS.md.`

## What this repo is
Cantabria Places Map: a small personal discovery and planning map for places, hikes and activities in Cantabria and the Picos de Europa. A static installable web app (plain JavaScript, Leaflet, a service worker for offline use) that works on desktop and iPhone. Live at https://explorecantabria.fyi on Hostinger shared hosting, with `noindex`. It is a snapshot: the Notion "Places & Activities" database stays the source of truth. **This repo is public**, so nothing private may ever be committed. It holds place data, hike tracks and public links, and no accounts or personal data.

## Standards that apply
Follow the Product Scope Coding Standard and Deployment Standard: https://github.com/DavidLortalPM/engineering-standards (`CODING-STANDARD.md`, `DEPLOYMENT-STANDARD.md`). Where this repo differs, see "Exceptions". If a rule is unclear, ask. Do not guess. `README.md` explains the data pipeline.

## Commands
| Task | Command |
|---|---|
| Install | `npm install` (there is a lockfile, so `npm ci` also works) |
| Run locally | `npm run dev` (wrangler dev, http://localhost:8787, preview only) |
| Rebuild data | `npm run data` (places, details and KML, from `data/` into `public/`) |
| Rebuild details only | `npm run details` |
| Rebuild KML only | `npm run kml` |
| Brand icons | `npm run brand` |
| Hike routes | `node scripts/build-routes.mjs` |
| Check everything | none exists. Unknown, ask David. See Exceptions |

`npm run deploy` only prints a reminder; it deploys nothing. There is no test, lint or typecheck command, so say so when reporting. Do not claim success without having run `npm run data` and looked at the result in a browser.

## Deploy and rollback
Tier B (app with no sensitive data). Today the site is deployed by hand: upload the contents of `public/` to the Hostinger site's `public_html` (archive upload or hPanel File Manager). `public/.htaccess` sets the `noindex` header and cache rules. No Cloudflare Worker is used in production. DNS stays at Cloudflare as two DNS-only (grey cloud) records, and must stay DNS-only because Spanish ISPs block Cloudflare's proxy during LaLiga matches. There is no workflow in this repo. Whether Hostinger Git auto-deploy is connected is unknown, ask David; if it is, merging to `main` would deploy. Never upload, deploy, change DNS or change hPanel settings without explicit approval. Rollback: re-upload the previous `public/` from an earlier commit (`git checkout <commit> -- public`), or use Hostinger's file restore if available. A written rollback is unknown, ask David.

## Folder map
- `public/`: the deployed site: `index.html`, `app.js`, `style.css`, `sw.js`, `data/` and `routes/` (generated), `vendor/`, `img/`, `.htaccess`, `_headers`.
- `data/`: source data (Notion snapshots, reviewed `coords.json`, hike GPX in `gpx/`, details, images, overrides).
- `scripts/`: build and research scripts (`build-data.mjs`, `build-details.mjs`, `build-routes.mjs`, `geocode.mjs` and others).

## Never do
- Never commit `.env`, `.dev.vars`, tokens, API keys, `data/_raw/` or any personal data. The repo is public.
- Never guess coordinates. A place without an entry in `data/coords.json` stays off the map.
- Never hand-edit generated files (`public/data/*`, `public/routes/*`, `public/cantabria-places.kml`). Change `data/` or `scripts/` and re-run.
- Never deploy, upload to hosting, change DNS or hPanel settings, or push to `main` without explicit approval.
- Never turn the Cloudflare proxy on for the site's DNS records.
- Never add a dependency, framework or third-party script without asking.
- Never copy code between repos. Share it.

## Always do
- Platform first: native HTML, then CSS, then a little JavaScript, then a library.
- Keep new files small (about 300 lines) and explain *why* in comments.
- Mark coordinates `verified`, `approximate` or `unverified`, and keep a source for hikes and routes.
- Bump `VERSION` in `public/sw.js` (currently `v16`) when a visible release needs installed copies to refresh their offline cache.
- End every code reply with "Standard applied": the rules used and any not followed, with the reason.

## Data and privacy
Public place and trail data only. Sources include Notion exports, CANTUR, OpenStreetMap, Wikipedia and Naturea GPX tracks. Do not paste Notion content beyond what already sits in `data/`. Do not send anything private to a model or third party. No `DATA.md` exists. Unknown, ask David whether one is needed.

## Exceptions to the standard
| Rule | Why | Owner | Review |
|---|---|---|---|
| No `npm run verify`, no tests, no CI | Small personal static app. To do: add `npm run verify` (data build succeeds, JSON valid, links resolve) | David | Unknown, ask David |
| Manual upload to Hostinger, no staging | Existing setup. The target is Hostinger Git auto-deploy (unknown whether available, ask David) | David | Unknown, ask David |
| Hosted on Hostinger, not Cloudflare | Spanish ISPs block Cloudflare during football matches (README) | David | Unknown, ask David |
| `npm run dev` uses wrangler, the standard release scripts are absent | Wrangler is for local preview only | David | Unknown, ask David |

## Learning log
- 2026-11-24: DON'T proxy the site through Cloudflare. DO keep both DNS records DNS-only, because Spanish ISPs block Cloudflare's shared addresses during LaLiga matches and the earlier Workers version was unreachable at weekends.
