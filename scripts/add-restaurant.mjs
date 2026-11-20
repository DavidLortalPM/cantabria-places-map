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
    if (/\/maps\/place\/|[?&]q=|@-?\d/.test(u) && /google\.[a-z.]+\/maps/.test(u)) break;
    const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA } });
    const loc = r.headers.get('location');
    if (!loc) break;
    u = new URL(loc, u).href;
    const m = u.match(/consent\.google\.[^/]+.*[?&]continue=([^&]+)/);
    if (m) u = decodeURIComponent(m[1]);
  }
  return u;
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
  const full = await resolve(url);
  const { name, lat, lon } = parse(full);
  if (!name || lat == null) { console.log('SKIP (could not read name/coords):', url, '->', full.slice(0, 120)); continue; }
  const m = osmMatch(name, lat, lon);
  const t = m?.tags || {};
  const entry = {
    name, category: 'restaurant', lat, lon, status: 'verified',
    source: 'Google Maps link supplied by owner' + (m ? '; details from OpenStreetMap (ODbL)' : ''),
    ...(cuisineLabel(t.cuisine) ? { kind: cuisineLabel(t.cuisine) } : {}),
    ...(t['addr:city'] || t['addr:suburb'] ? { area: t['addr:city'] || t['addr:suburb'] } : {}),
    ...(t.opening_hours ? { hours: 'OSM: ' + t.opening_hours + ' (check before going)' } : {}),
    ...(t.phone || t['contact:phone'] ? { phone: t.phone || t['contact:phone'] } : {}),
    ...((t.website || t['contact:website']) ? { link: t.website || t['contact:website'] } : {}),
    ...(url.startsWith('http') ? { gmaps: url } : {})
  };
  const i = list.findIndex(x => norm(x.name) === norm(name) && Math.abs(x.lat - lat) < 0.001);
  if (i >= 0) list[i] = { ...list[i], ...entry }; else list.push(entry);
  console.log(i >= 0 ? 'UPDATED' : 'ADDED  ', name, `(${lat}, ${lon})`, m ? '+ OSM: ' + Object.keys(t).filter(k => /cuisine|opening|phone|website/.test(k)).join(',') : '(no OSM match)');
}
fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
