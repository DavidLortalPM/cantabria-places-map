// Builds public/cantabria-places.kml: every place (and every hike route line) for Google My Maps.
// Import: mymaps.google.com > Create a new map > Import > choose the file. Run: node scripts/build-kml.mjs
import fs from 'node:fs';
const { places } = JSON.parse(fs.readFileSync('public/data/places.json', 'utf8'));
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const GROUPS = [['hike', 'Hikes', 'ff5a855f'], ['walk', 'Walks', 'ff907c0e'], ['restaurant', 'Food', 'ff3030c5'], ['cultura', 'Cultural Pass', 'ffd5655d'], ['family', 'Family', 'ffb26b2b'], ['attraction', 'Sights', 'ff2078dd']];
const pin = p => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
let k = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Cantabria places</name><description>Exported from explorecantabria.fyi. Positions come from the sources named on each place; check opening times before you go.</description>\n`;
for (const [c, , col] of GROUPS) k += `<Style id="s-${c}"><IconStyle><color>${col}</color><scale>1.0</scale><Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle><LineStyle><color>${col}</color><width>4</width></LineStyle></Style>\n`;
let n = 0, lines = 0;
for (const [c, label] of GROUPS) {
  const list = places.filter(p => p.category === c && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!list.length) continue;
  k += `<Folder><name>${esc(label)}</name>\n`;
  for (const p of list) {
    const bits = [p.kind, p.area, p.hike?.distanceKm ? p.hike.distanceKm + ' km' : '', p.priceLevel, p.phone].filter(Boolean).join(' · ');
    const desc = `${esc(bits)}${bits ? '<br>' : ''}${p.description ? esc(p.description) + '<br>' : ''}<a href="${esc(p.gmaps || pin(p))}">Open in Google Maps</a> · <a href="https://explorecantabria.fyi/#${esc(p.id)}">Open in the map app</a>`;
    k += `<Placemark><name>${esc(p.name)}</name><description><![CDATA[${desc}]]></description><styleUrl>#s-${c}</styleUrl><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>\n`; n++;
    if (p.route && fs.existsSync(`public/routes/${p.id}.json`)) {
      const r = JSON.parse(fs.readFileSync(`public/routes/${p.id}.json`, 'utf8'));
      if (r.points?.length > 1) { k += `<Placemark><name>${esc(p.name)} (route)</name><styleUrl>#s-${c}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${r.points.map(q => `${q[1]},${q[0]},0`).join(' ')}</coordinates></LineString></Placemark>\n`; lines++; }
    }
  }
  k += `</Folder>\n`;
}
k += `</Document></kml>\n`;
fs.writeFileSync('public/cantabria-places.kml', k);
console.log(`wrote public/cantabria-places.kml: ${n} places, ${lines} route lines, ${(k.length / 1024).toFixed(0)} KB`);
