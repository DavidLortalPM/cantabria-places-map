// Add restaurants to data/restaurants.json from Google Maps links.
//   node scripts/add-restaurant.mjs <google-maps-url> [more urls...]
// From each link we take only the place name and coordinates (they are in the URL).
// Cuisine, opening hours, phone and website are filled from OpenStreetMap (Overpass) when a matching
// venue is mapped within ~80 m. Nothing is copied from Google's own pages. Then run: node scripts/build-data.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'data/restaurants.json';
const UA = 'Mozilla/5.0 (compatible; personal-map-tool)';
const AMENITY = 'restaurant|cafe|bar|pub|fast_food|ice_cream|biergarten|food_court';
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function resolve(url) {
  let u = url;
  for (let i = 0; i < 6; i++) {
    if (/\/maps\/place\/|[?&]q=|@-?\d/.test(u) && /google\.[a-z.]+\/(maps|search)/.test(u)) break;
    const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA } });
    const loc = r.headers.get('location');
    if (!loc) break;
    u = new URL(loc, u).href;
    const m = u.match(/consent\.google\.[^/]+.*[?&]continue=([^&]+)/);
    if (m) u = decodeURIComponent(m[1]);
  }
  return u;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Name (and optional address) from a maps?q=... or search?q=... URL; no coordinates in these
function parseQuery(u) {
  try { const q = new URL(u).searchParams.get('q'); if (q && !/^-?\d+\.\d+,/.test(q)) return { name: q.split(',')[0].trim(), text: q }; } catch {}
  return null;
}
// Coordinates from OpenStreetMap's Nominatim (never guessed): full text first, then the name inside Cantabria/Asturias
async function geocode(name, text, hint) {
  const tries = [];
  if (text && text !== name) tries.push({ q: text });
  tries.push({ q: name + (hint ? ', ' + hint : ''), vb: '-6.2,42.9,-3.0,43.7' });
  for (const t of tries) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=es&q=' + encodeURIComponent(t.q) + (t.vb ? '&viewbox=' + t.vb + '&bounded=1' : '');
    const r = await (await fetch(url, { headers: { 'user-agent': 'personal-map-tool' } })).json();
    await sleep(1100);
    const n = norm(name);
    const hit = r.find(x => ['amenity', 'shop', 'tourism', 'leisure'].includes(x.class) && (norm(x.name || x.display_name.split(',')[0]).includes(n) || n.includes(norm(x.name || ''))));
    if (hit) return { lat: +(+hit.lat).toFixed(6), lon: +(+hit.lon).toFixed(6), geo: 'OpenStreetMap (Nominatim): ' + hit.display_name.split(',').slice(0, 3).join(',').trim() };
  }
  return null;
}

function parse(u) {
  const dec = s => decodeURIComponent(s.replace(/\+/g, ' '));
  const name = (u.match(/\/maps\/place\/([^/@?]+)/) || [])[1];
  const pin = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || u.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  return { name: name ? dec(name) : null, lat: pin ? +pin[1] : null, lon: pin ? +pin[2] : null };
}

function overpass(q) {
  for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const out = execFileSync('curl', ['-s', '--max-time', '40', '-A', UA, '--data-urlencode', 'data=' + q, ep], { encoding: 'utf8' });
      return JSON.parse(out).elements || [];
    } catch { /* try next endpoint */ }
  }
  return [];
}

function osmMatch(name, lat, lon) {
  const els = overpass(`[out:json][timeout:30];nwr["amenity"~"^(${AMENITY})$"](around:80,${lat},${lon});out center tags;`);
  const n = norm(name);
  const scored = els.filter(e => e.tags?.name).map(e => {
    const en = norm(e.tags.name);
    return { e, score: en === n ? 3 : (en.includes(n) || n.includes(en)) ? 2 : 0 };
  }).filter(x => x.score).sort((a, b) => b.score - a.score);
  return scored[0]?.e || null;
}

const CUISINE = { regional: 'Regional', seafood: 'Seafood', fish: 'Seafood', pizza: 'Pizza', burger: 'Burgers', tapas: 'Tapas', steak_house: 'Grill', grill: 'Grill', italian: 'Italian', spanish: 'Spanish', coffee_shop: 'Café', ice_cream: 'Ice cream', cider: 'Sidrería', asian: 'Asian', chinese: 'Chinese', japanese: 'Japanese', mexican: 'Mexican', vegetarian: 'Vegetarian', vegan: 'Vegan', bakery: 'Bakery' };
const cuisineLabel = c => c ? c.split(';').map(x => CUISINE[x] || x.replace(/_/g, ' ')).map(x => x[0].toUpperCase() + x.slice(1)).slice(0, 2).join(' / ') : '';

const list = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];
const urls = process.argv.slice(2);
if (!urls.length) { console.error('usage: node scripts/add-restaurant.mjs <google-maps-url> ...'); process.exit(1); }

for (const url of urls) {
  let name, lat, lon, geoNote = '';
  if (!/^https?:/.test(url)) {                       // plain name, optionally "Name | town"
    const [nm, hint] = url.split('|').map(x => x.trim());
    name = nm; const g = await geocode(nm, null, hint || 'Cantabria'); if (g) ({ lat, lon } = g), geoNote = g.geo;
  } else {
    const full = await resolve(url);
    ({ name, lat, lon } = parse(full));
    if (lat == null) {
      const q = parseQuery(full);
      if (q) { name = q.name; const g = await geocode(q.name, q.text, 'Cantabria'); if (g) ({ lat, lon } = g), geoNote = g.geo; }
    }
  }
  if (!name || lat == null) { console.log('NEEDS DETAILS (no coordinates found):', name || url); continue; }
  const m = osmMatch(name, lat, lon);
  const t = m?.tags || {};
  const entry = {
    name, category: 'restaurant', lat, lon, status: 'verified',
    source: (geoNote ? 'Place named by owner; position from ' + geoNote : 'Google Maps link supplied by owner') + (m ? '; details from OpenStreetMap (ODbL)' : ''),
    ...(cuisineLabel(t.cuisine) ? { kind: cuisineLabel(t.cuisine) } : {}),
    ...(t['addr:city'] || t['addr:suburb'] ? { area: t['addr:city'] || t['addr:suburb'] } : {}),
    ...(t.opening_hours ? { hours: 'OSM: ' + t.opening_hours + ' (check before going)' } : {}),
    ...(t.phone || t['contact:phone'] ? { phone: t.phone || t['contact:phone'] } : {}),
    ...((t.website || t['contact:website']) ? { link: t.website || t['contact:website'] } : {}),
    ...(/maps\.app\.goo\.gl/.test(url) ? { gmaps: url } : {})
  };
  const i = list.findIndex(x => norm(x.name) === norm(name) && Math.abs(x.lat - lat) < 0.001);
  if (i >= 0) list[i] = { ...list[i], ...entry }; else list.push(entry);
  console.log(i >= 0 ? 'UPDATED' : 'ADDED  ', name, `(${lat}, ${lon})`, m ? '+ OSM: ' + Object.keys(t).filter(k => /cuisine|opening|phone|website/.test(k)).join(',') : '(no OSM match)');
}
fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
