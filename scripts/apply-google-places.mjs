// Applies Google Maps lookups to the restaurants: a link to the actual Google Maps listing (maps.google.com/?cid=...)
// and the listing's own pin. Input: a lines file "index|featureId|lat|lon||name" made by searching each restaurant in
// Google Maps in a browser (name + street address), and the query list it came from (same indexes; src is list, orig
// or dropped). When Google returned several results the name field is "LIST:name@fid@lat,lon / ..." and we pick one.
//   node scripts/apply-google-places.mjs <results.txt> <queries.json> [out.csv]
// A result is accepted only when the listing name shares a word with ours and its pin is within 1.5 km of where we
// already had the restaurant. Everything else is left unchanged and marked "check" in the CSV.
// List restaurants get the pin and link in data/restaurant-geo.json (how: 'google', which the import marks verified);
// hand-made restaurants in data/restaurants.json get the gmaps link when they have none; dropped ones only go in the CSV.
import fs from 'node:fs';

const [resFile, qFile, csvFile = 'data/_raw/restaurants-google.csv'] = process.argv.slice(2);
const queries = JSON.parse(fs.readFileSync(qFile, 'utf8'));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['restaurante', 'restaurant', 'bar', 'pizzeria', 'the', 'de', 'la', 'el', 'los', 'las', 'y', 'and', 'sushi', 'kebab', 'burger', 'jatetxea', 'del', 'con']);
const words = s => norm(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w));
const exact = (a, b) => norm(a) === norm(b) || (norm(a).length >= 6 && norm(b).includes(norm(a)));
const sameName = (a, b) => exact(a, b) || exact(b, a) || words(a).some(w => norm(b).includes(w)) || words(b).some(w => norm(a).includes(w));
// The second half of Google's feature id ("0x…:0x…") is the listing's CID; maps.google.com/?cid=<decimal> opens that listing
const cidLink = fid => 'https://maps.google.com/?cid=' + BigInt(fid.split(':')[1]).toString();
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 81);

const cache = JSON.parse(fs.readFileSync('data/restaurant-geo.json', 'utf8'));
const orig = JSON.parse(fs.readFileSync('data/restaurants.json', 'utf8'));
const tsv = fs.existsSync('data/_raw/intl-restaurants.tsv') ? fs.readFileSync('data/_raw/intl-restaurants.tsv', 'utf8').trim().split('\n').map(l => l.split('\t')) : [];
const head = tsv.shift() || [];
const info = Object.fromEntries(tsv.map(r => { const o = Object.fromEntries(head.map((k, i) => [k, r[i]])); return [o.Name + ' | ' + o.Address, o]; }));

const CHECKED = { 'Restaurante Hong Kong': 'postcode 48960 is Galdakao, where Google has it', 'Japanese Restaurant in Bilbao': 'the list name is cut at |: it is Izu Sushi' };
const rows = [];
let applied = 0;
for (const line of fs.readFileSync(resFile, 'utf8').split('\n').filter(Boolean)) {
  const [i, fid0, lat0, lon0, name0] = line.split('|');
  const q = queries[+i];
  if (!q) continue;
  const ours = q.k.split(' | ')[0];
  const prev = q.src === 'orig' ? orig.find(x => x.name === q.k) : cache[q.k];
  let hit = fid0 ? { fid: fid0, lat: +lat0, lon: +lon0, name: (name0 || '').replace(/^LIST1:/, '') } : null;
  if (!hit && name0?.startsWith('LIST:')) { // several results: the nearest one whose name matches
    const cands = name0.slice(5).split(' / ').map(s => { const [n, f, ll] = s.split('@'); const [la, lo] = (ll || '').split(','); return { name: n, fid: f, lat: +la, lon: +lo }; })
      .filter(c => c.fid && c.fid !== 'null' && sameName(ours, c.name));
    if (prev) cands.sort((a, b) => km(a, prev) - km(b, prev));
    hit = cands[0] || null;
  }
  const dist = hit && prev?.lat != null ? km(hit, prev) : null;
  // the same name may sit further from our old pin (that pin came from an address lookup and can be off); a listing named
  // differently must be close. CHECKED: matches a person looked at and confirmed (the postcode or full name settles it)
  const ok = hit && (CHECKED[ours] || (sameName(ours, hit.name) && (dist === null || dist <= ((exact(ours, hit.name) || exact(hit.name, ours)) ? 5 : 1.5))));
  const t = info[q.k] || {};
  rows.push({ status: q.src === 'dropped' ? 'dropped' : 'on map', name: ours, town: t.Town || prev?.area || '', rating: t.Rating || prev?.rating || '', reviews: t.Reviews || '',
    google: hit ? cidLink(hit.fid) : '', googleName: hit?.name || '', check: ok ? '' : hit ? `name or place differs (${dist === null ? '?' : dist.toFixed(1)} km)` : 'not found' });
  if (!ok) continue;
  if (q.src === 'list' && q.k in cache) { cache[q.k] = { lat: +hit.lat.toFixed(6), lon: +hit.lon.toFixed(6), how: 'google', gmaps: cidLink(hit.fid), match: 'Google Maps listing: ' + hit.name }; applied++; }
  if (q.src === 'orig') { const o = orig.find(x => x.name === q.k); if (o && !o.gmaps) { o.gmaps = cidLink(hit.fid); applied++; } }
}
fs.writeFileSync('data/restaurant-geo.json', JSON.stringify(cache, null, 1));
fs.writeFileSync('data/restaurants.json', JSON.stringify(orig, null, 2) + '\n');
const csv = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
const cols = ['status', 'name', 'town', 'rating', 'reviews', 'google', 'googleName', 'check'];
fs.writeFileSync(csvFile, [cols.join(','), ...rows.map(r => cols.map(c => csv(r[c])).join(','))].join('\n') + '\n');
console.log(`applied ${applied}; rows ${rows.length}; to check ${rows.filter(r => r.check).length}; csv ${csvFile}`);
for (const r of rows.filter(r => r.check)) console.log(`  [${r.status}] ${r.name} (${r.town}): ${r.check}${r.googleName ? ' -> ' + r.googleName : ''}`);
