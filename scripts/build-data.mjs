// Builds public/data/places.json from Notion snapshots (data/*.notion.json) plus reviewed coordinates.
// Coordinates are never guessed: a Notion row with no entry in the coords file is left off the map and listed in `unplaced`.
//   Cultura: data/cultura.notion.json + data/coords.json (+ descriptions.json, images.json)
//   Hikes:   data/hikes.notion.json  + data/hike-coords.json (+ hike-overrides.json)
// Usage: node scripts/build-data.mjs   (or: npm run data)
import fs from 'node:fs';

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const places = [];
const unplaced = [];

// ---- Pasaporte Cultura
const cultura = read('data/cultura.notion.json');
const coords = read('data/coords.json');
const desc = read('data/descriptions.json');
const opening = fs.existsSync('data/opening.json') ? read('data/opening.json') : {};
const images = fs.existsSync('data/images.json') ? read('data/images.json') : {};
for (const n of cultura) {
  const c = coords[n.name];
  if (!c) { unplaced.push({ name: n.name, category: 'cultura' }); continue; }
  places.push({
    id: slug(n.name), name: n.name, category: 'cultura', kind: c.kind, area: n.area,
    description: desc[n.name], image: images[n.name],
    lat: c.lat, lon: c.lon, locationStatus: c.status, locationSource: c.source,
    drive: n.drive, visitTime: n.visit, hours: n.hours, adult: n.adult, child: n.child,
    open: opening[n.name], rainyDay: n.rainy, familyFriendly: true, booking: n.booking, link: n.link, notion: n.notion
  });
}

// ---- Hikes (map pin = trailhead / start, not the route)
if (fs.existsSync('data/hikes.notion.json')) {
  const hikes = read('data/hikes.notion.json');
  const hc = fs.existsSync('data/hike-coords.json') ? read('data/hike-coords.json') : {};
  const ov = fs.existsSync('data/hike-overrides.json') ? read('data/hike-overrides.json') : {};
  const num = v => (v === null || v === undefined || v === '' ? undefined : v);
  for (const h of hikes) {
    const c = hc[h.Name];
    if (!c || c.lat == null) { unplaced.push({ name: h.Name, category: 'hike', stage: h['Hiking Stage'] }); continue; }
    const o = ov[h.Name] || {};
    // "Full track" only counts if we actually hold a track/GPX URL.
    const gpxUrl = h['Track / GPX'] || undefined;
    const geometry = h['Route Geometry Status'] === 'Full track' && !gpxUrl ? 'Missing' : h['Route Geometry Status'];
    const hike = {
      distanceKm: num(h['Distance (km)']), ascentM: num(h['Elevation Gain (m)']), duration: num(h.Duration),
      difficulty: num(h.Difficulty), stage: num(h['Hiking Stage']), routeType: num(h['Route Type']),
      childSuitability: num(h['Child Suitability']), conditions: num(h['Best Months / Conditions']),
      exposure: num(h['Exposure / Scrambling']), trailhead: num(h['Trailhead / Start']), parking: num(h.Parking),
      terrain: num(h.Terrain), officialUrl: num(h['Official Route']), allTrailsUrl: num(h.AllTrails), gpxUrl,
      routeGeometry: geometry, trackSource: num(h['Track Source']),
      ...(o.hike || {})
    };
    for (const k of Object.keys(hike)) if (hike[k] === undefined) delete hike[k];
    places.push({
      id: slug(h.Name), name: o.name || h.Name, category: 'hike', area: h.Area,
      lat: c.lat, lon: c.lon, locationStatus: c.status, locationSource: c.source + (c.note ? ` — ${c.note}` : ''),
      why: num(h['Why do it?']), familyFriendly: h['Family Friendly'] === '__YES__', priority: num(h.Priority),
      notion: h.url.replace('app.notion.com/', 'app.notion.com/p/'), hike
    });
  }
}

places.sort((a, b) => a.name.localeCompare(b.name, 'es'));
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/places.json', JSON.stringify({ generated: new Date().toISOString().slice(0, 10), places, unplaced }, null, 1));
console.log('wrote', places.length, 'places;', unplaced.length, 'unplaced:', unplaced.map(u => u.name).join('; ') || '-');
