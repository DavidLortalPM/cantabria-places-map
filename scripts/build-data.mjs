// Builds public/data/places.json from Notion snapshots (data/*.notion.json) plus reviewed coordinates.
// Coordinates are never guessed: a Notion row with no entry in the coords file is left off the map and listed in `unplaced`.
//   Cultura: data/cultura.notion.json + data/coords.json (+ descriptions.json, images.json)
//   Hikes:   data/hikes.notion.json  + data/hike-coords.json (+ hike-overrides.json)
// Usage: node scripts/build-data.mjs   (or: npm run data)
import fs from 'node:fs';
import { deriveTags } from './derive-tags.mjs';

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const places = [];
const unplaced = [];
// Scheme memberships (e.g. 'Pasaporte Cultura') are extra tags on top of the one category: an optional `schemes` array
// or a Notion-style 'Pass / Scheme' field (array or comma-separated text) on any row. Returns undefined when there are none.
const PASS = 'Pasaporte Cultura';
const schemesOf = (o, ...extra) => {
  const v = [o.schemes, o['Pass / Scheme']].flat().flatMap(s => String(s ?? '').split(','));
  const a = [...new Set([...extra, ...v].map(s => s.trim()).filter(Boolean))];
  return a.length ? a : undefined;
};

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
    id: slug(n.name), name: n.name, category: 'cultura', schemes: schemesOf(n, PASS), kind: c.kind, area: n.area,
    description: desc[n.name], image: images[n.name],
    lat: c.lat, lon: c.lon, locationStatus: c.status, locationSource: c.source,
    drive: n.drive, visitTime: n.visit, hours: n.hours, adult: n.adult, child: n.child,
    open: opening[n.name], rainyDay: n.rainy, booking: n.booking, link: n.link // no family-friendly field in the source, so none is claimed
  });
}

// ---- Hikes (map pin = trailhead / start, not the route)
if (fs.existsSync('data/hikes.notion.json')) {
  const hikes = read('data/hikes.notion.json');
  const hc = fs.existsSync('data/hike-coords.json') ? read('data/hike-coords.json') : {};
  const ov = fs.existsSync('data/hike-overrides.json') ? read('data/hike-overrides.json') : {};
  const num = v => (v === null || v === undefined || v === '' ? undefined : v);
  const hidden = new Set(fs.existsSync('data/hidden-hikes.json') ? read('data/hidden-hikes.json').names : []);
  for (const h of hikes) {
    if (hidden.has(h.Name)) continue; // kept in Notion and data/, off the map until re-added (data/hidden-hikes.json)
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
      id: slug(h.Name), name: o.name || h.Name, category: h.Type === 'Walk' ? 'walk' : 'hike', area: h.Area,
      lat: c.lat, lon: c.lon, locationStatus: c.status, locationSource: c.source + (c.note ? ` — ${c.note}` : ''),
      why: num(h['Why do it?']), familyFriendly: h['Family Friendly'] === '__YES__', priority: num(h.Priority),
      schemes: schemesOf(h), hike
    });
  }
}

// ---- Family activities, places and easy walks (hand-transcribed from Notion into data/other.json)
if (fs.existsSync('data/other.json')) {
  for (const o of read('data/other.json')) {
    const { status, source, 'Pass / Scheme': _, ...rest } = o;
    places.push({ id: slug(o.name), locationStatus: status, locationSource: source, ...rest, schemes: schemesOf(o) });
  }
  unplaced.push({ name: 'Sendero de Castrejón', category: 'walk' });
}

// ---- Restaurants (data/restaurants.json; added with scripts/add-restaurant.mjs from Google Maps links)
// Optional fields shown as sheet tags: kind, priceLevel (€ … €€€€), reservations ("No reservations" | "Book ahead").
const RESERVATIONS = new Set(['No reservations', 'Book ahead']);
if (fs.existsSync('data/restaurants.json')) {
  for (const o of read('data/restaurants.json')) {
    const { status, source, 'Pass / Scheme': _, ...rest } = o;
    if (o.reservations && !RESERVATIONS.has(o.reservations)) console.warn('warning:', o.name, 'has unknown reservations value', JSON.stringify(o.reservations));
    places.push({ id: slug(o.name), category: 'restaurant', locationStatus: status, locationSource: source, ...rest, schemes: schemesOf(o) });
  }
}

// ---- The owner's restaurant list (data/restaurants.list.json, made by scripts/import-restaurant-list.mjs)
if (fs.existsSync('data/restaurants.list.json')) {
  for (const o of read('data/restaurants.list.json')) {
    if (o.mergeInto) { // same place as a hand-made entry: add the list's rating and opening details to it
      const p = places.find(x => x.category === 'restaurant' && x.name === o.mergeInto);
      if (p) for (const k of ['rating', 'reviews', 'cuisine', 'lunch', 'closedOn', 'notes']) if (o[k] !== undefined && p[k] === undefined) p[k] = o[k];
      continue;
    }
    const { status, source, ...rest } = o;
    let id = slug(o.name + ' ' + o.area); while (places.some(p => p.id === id)) id += '-2';
    places.push({ id, category: 'restaurant', kind: o.cuisine, locationStatus: status, locationSource: source, ...rest });
  }
}

// Hikes are only published once there is a route to draw (public/routes/<id>.json, see scripts/build-routes.mjs).
// HIKES_NEED_ROUTE=0 publishes every placed hike; HIDE_CATEGORIES=a,b keeps whole categories out.
const HIDE = new Set((process.env.HIDE_CATEGORIES ?? '').split(',').map(s => s.trim()).filter(Boolean));
const routeFile = id => 'public/routes/' + id + '.json';
for (let i = places.length - 1; i >= 0; i--) {
  const p = places[i];
  if ((p.category === 'hike' || p.category === 'walk') && fs.existsSync(routeFile(p.id))) {
    const r = read(routeFile(p.id));
    p.route = { km: r.km, source: r.source, sourceUrl: r.sourceUrl, circular: r.circular, ...(r.note ? { note: r.note } : {}) };
  }
  const noRoute = p.category === 'hike' && !p.route && process.env.HIKES_NEED_ROUTE !== '0';
  if (HIDE.has(p.category) || noRoute) places.splice(i, 1);
}
// Hikes still waiting for a start point are not listed either (they are not on the map and have no route).
for (let i = unplaced.length - 1; i >= 0; i--) if (HIDE.has(unplaced[i].category) || unplaced[i].category === 'hike') unplaced.splice(i, 1);

for (const p of places) if (!p.image && images[p.name]) p.image = images[p.name]; // Commons photos for non-Cultura places
for (const p of places) { const t = deriveTags(p); if (t.length) p.tags = t; delete p.listedBy; delete p.extraTags; }
places.sort((a, b) => a.name.localeCompare(b.name, 'es'));
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/places.json', JSON.stringify({ generated: new Date().toISOString().slice(0, 10), places, unplaced }, null, 1));
console.log('wrote', places.length, 'places;', unplaced.length, 'unplaced:', unplaced.map(u => u.name).join('; ') || '-');
