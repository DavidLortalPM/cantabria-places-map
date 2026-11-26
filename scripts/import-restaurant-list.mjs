// Imports the owner's restaurant list (tab-separated, pasted from a spreadsheet) into data/restaurants.list.json.
//   node scripts/import-restaurant-list.mjs [data/_raw/intl-restaurants.tsv]      (which rows go on the map: scripts/restaurant-rules.mjs)
// Columns: Name, Cuisine, Town, Province, Rating, Reviews, Price, Open for lunch?, Closed on, Opening hours, Good to know,
//          Google Maps, Phone, Address.
// Coordinates are never guessed: each row is looked up on OpenStreetMap (Nominatim), first as a named venue in its town,
// then by street address. Lookups are cached in data/restaurant-geo.json; rows with no hit are listed and left off the map.
// Rows already in data/restaurants.json (same phone, or same name in the same town) are not added again: their rating and
// opening details are written as mergeInto rows instead, which build-data.mjs copies onto the hand-made entry.
import fs from 'node:fs';
import { verdict } from './restaurant-rules.mjs';

const SRC = process.argv[2] || 'data/_raw/intl-restaurants.tsv';
const CACHE = 'data/restaurant-geo.json';
const OUT = 'data/restaurants.list.json';
const UA = 'cantabria-places-map/0.3 (personal tool)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const digits = s => String(s || '').replace(/\D/g, '').slice(-9);

const rows = fs.readFileSync(SRC, 'utf8').trim().split('\n').map(l => l.split('\t'));
const head = rows.shift().map(s => s.trim());
const recs = rows.map(r => Object.fromEntries(head.map((k, i) => [k, (r[i] ?? '').trim()])));
const existing = JSON.parse(fs.readFileSync('data/restaurants.json', 'utf8'));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

const ABBR = [[/\bC\/\s*/g, 'Calle '], [/\bC\.\s*/g, 'Calle '], [/\bCl\.\s*/g, 'Calle '], [/\bAv(da)?\.\s*/g, 'Avenida '], [/\bP\.º\s*/g, 'Paseo '],
  [/\bPl\.\s*/g, 'Plaza '], [/\bCam\.\s*/g, 'Camino '], [/\bB[oº]\.?\s+/g, 'Barrio '], [/\bTr\.ª\s*/g, 'Travesía '], [/\bCtra\.\s*/g, 'Carretera '],
  [/\bGral\.\s*/g, 'General '], [/\bDr\.\s*/g, 'Doctor '], [/\bSta\.\s*/g, 'Santa '], [/\bProf\.\s*/g, 'Profesor '], [/\bLic\.\s*/g, 'Licenciado '],
  [/\bBlvr\.\s*/g, 'Bulevar '], [/\bEtorb\.\s*/g, 'Etorbidea '], [/\bK\.\s*/g, 'Kalea ']];
const expand = s => ABBR.reduce((a, [re, to]) => a.replace(re, to), s);
// "C. del Dr. Graiño, 41, 1, 33402 Avilés, Asturias" -> "Calle del Doctor Graiño 41, 33402 Avilés"
function addrQuery(a) {
  const parts = a.split(',').map(s => s.trim()).filter(Boolean);
  const pc = parts.findIndex(p => /\b\d{5}\b/.test(p));
  if (pc < 0) return null;
  const street = parts.slice(0, pc).find(p => /[a-zà-ÿ]{3}/i.test(p) && !/^(bajo|bj|local|loc|izquierda|dcha|drch)/i.test(p));
  if (!street) return null;
  const num = parts.slice(parts.indexOf(street) + 1, pc).find(p => /^\d+[a-z]?$/i.test(p));
  return { q: `${expand(street)}${num ? ' ' + num : ''}, ${parts[pc]}`, pc: parts[pc].match(/\d{5}/)[0] };
}
const inArea = (lat, lon) => lat > 42.7 && lat < 43.8 && lon > -7.3 && lon < -2.3;

async function nom(params) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=es&' + new URLSearchParams(params);
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': UA } }); await sleep(1100); if (r.ok) return await r.json(); }
    catch { await sleep(3000); }
  }
  return [];
}
async function locate(r) {
  // 1) the venue itself, by name, in its town
  const town = r.Town.replace(/\s*\(.*\)/, '');
  const n = norm(r.Name.replace(/^(restaurante?|bar|pizzeria|pizzería)\s+/i, '').split(/[|\-–(]/)[0]);
  const hits = await nom({ q: `${r.Name.split(/[|(]/)[0].trim()}, ${town}` });
  const venue = hits.find(x => ['amenity', 'shop', 'tourism'].includes(x.category) && n.length >= 3 &&
    (norm(x.name).includes(n) || (norm(x.name).length >= 4 && n.includes(norm(x.name)))) && inArea(+x.lat, +x.lon) &&
    // the venue must be on the listed street: a same-name place elsewhere in town (or a school called the same) is not it
    norm(r.Address).split(' ').filter(w => w.length >= 5 && !/^(calle|avenida|kalea|plaza|asturias|bizkaia|cantabria|vizcaya)$/.test(w)).some(w => norm(x.display_name).includes(w)));
  if (venue) return { lat: +(+venue.lat).toFixed(6), lon: +(+venue.lon).toFixed(6), how: 'venue', match: venue.display_name.split(',').slice(0, 3).join(',') };
  // 2) the street address (building or street; the postcode must agree when OSM gives one)
  const a = addrQuery(r.Address);
  if (!a) return null;
  const ah = await nom({ q: a.q });
  const hit = ah.find(x => inArea(+x.lat, +x.lon) && (!x.address?.postcode || x.address.postcode === a.pc));
  if (hit) return { lat: +(+hit.lat).toFixed(6), lon: +(+hit.lon).toFixed(6), how: hit.address?.house_number ? 'address' : 'street', match: hit.display_name.split(',').slice(0, 3).join(',') };
  return null;
}

const judged = recs.map(r => ({ r, v: verdict(r) }));
const keep = judged.filter(x => x.v.keep).map(x => x.r);
const skipped = { rules: judged.filter(x => !x.v.keep), alreadyListed: [], noLocation: [] };
const sameAs = r => existing.find(e => (e.phone && digits(e.phone) === digits(r.Phone)) ||
  (norm(e.name).length >= 4 && norm(r.Name).includes(norm(e.name)) && norm(e.area).includes(norm(r.Town.replace(/\s*\(.*\)/, '')))));
// The list's town is wrong for some rows: the postcode wins
const TOWN_BY_POSTCODE = { 48960: 'Galdakao' };
const out = [];
let n = 0;
for (const r of keep) {
  const dup = sameAs(r);
  if (dup) { skipped.alreadyListed.push(r.Name + ' = ' + dup.name); const nn = r['Good to know'].split(',').map(s => s.trim()).filter(Boolean);
    out.push({ mergeInto: dup.name, rating: +r.Rating, reviews: +r.Reviews.replace(/,/g, '') || undefined, cuisine: r.Cuisine, lunch: r['Open for lunch?'] || undefined, closedOn: r['Closed on'] || undefined, notes: nn.length ? nn : undefined }); continue; }
  const key = r.Name + ' | ' + r.Address;
  if (!(key in cache)) { cache[key] = await locate(r); if (++n % 10 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1)); console.log(n, 'looked up'); } }
  const g = cache[key];
  if (!g) { skipped.noLocation.push(`${r.Name} (${r.Town})`); continue; }
  const notes = r['Good to know'].split(',').map(s => s.trim()).filter(Boolean);
  out.push({
    name: r.Name, area: TOWN_BY_POSTCODE[(r.Address.match(/d{5}/) || [])[0]] || r.Town, province: r.Province, cuisine: r.Cuisine,
    rating: +r.Rating, reviews: +r.Reviews.replace(/,/g, '') || undefined, priceLevel: r.Price || undefined,
    lunch: r['Open for lunch?'] || undefined, closedOn: r['Closed on'] || undefined, hours: r['Opening hours'] || undefined,
    notes: notes.length ? notes : undefined, reservations: notes.includes('Book ahead') ? 'Book ahead' : undefined,
    phone: r.Phone.replace(/^'/, '') || undefined, address: r.Address || undefined,
    gmaps: g.gmaps, lat: g.lat, lon: g.lon, status: g.how === 'google' ? 'verified' : g.how === 'street' ? 'approximate' : 'geocoded',
    source: `Owner's restaurant list (Google ratings); position ${g.how === 'google' ? 'from its Google Maps listing' : 'from OpenStreetMap by ' + (g.how === 'venue' ? 'venue name' : g.how === 'address' ? 'street address' : 'street (approximate)')}`
  });
}
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`on the map: ${out.filter(x => !x.mergeInto).length}; dropped by the rules: ${skipped.rules.length}; merged into existing entries: ${skipped.alreadyListed.join('; ') || '-'}`);
fs.writeFileSync('data/_raw/restaurant-decisions.txt', skipped.rules.map(x => `${x.r.Name} (${x.r.Town}): ${x.v.why}`).join('\n') + '\n\nNo location found:\n' + skipped.noLocation.join('\n') + '\n');
console.log(`no location (${skipped.noLocation.length}): ${skipped.noLocation.join('; ')}`);
const how = {}; for (const v of Object.values(cache)) how[v ? v.how : 'none'] = (how[v ? v.how : 'none'] || 0) + 1; console.log('lookups:', how);
