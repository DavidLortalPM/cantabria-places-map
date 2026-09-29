// Builds public/data/places.json from a Notion snapshot (data/*.notion.json) plus reviewed coordinates (data/coords.json).
// Coordinates are never guessed: a Notion row with no entry in coords.json is skipped and reported.
// Usage: node scripts/build-data.mjs
import fs from 'node:fs';

const notion = JSON.parse(fs.readFileSync('data/cultura.notion.json', 'utf8'));
const coords = JSON.parse(fs.readFileSync('data/coords.json', 'utf8'));

const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const places = [];
for (const n of notion) {
  const c = coords[n.name];
  if (!c) { console.warn('NO COORDS (skipped):', n.name); continue; }
  places.push({
    id: slug(n.name), name: n.name, category: 'cultura', kind: c.kind, area: n.area,
    lat: c.lat, lon: c.lon, locationStatus: c.status, locationSource: c.source,
    drive: n.drive, visitTime: n.visit, hours: n.hours, adult: n.adult, child: n.child,
    rainyDay: n.rainy, familyFriendly: true, booking: n.booking, link: n.link, notion: n.notion
  });
}
places.sort((a, b) => a.name.localeCompare(b.name, 'es'));

fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/places.json', JSON.stringify({ generated: new Date().toISOString().slice(0, 10), places }, null, 1));
console.log('wrote', places.length, 'places');
