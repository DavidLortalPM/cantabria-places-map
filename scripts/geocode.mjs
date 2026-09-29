// One-off helper: prints OSM Nominatim candidates for each query so a human can verify before data/places.json is edited.
const qs = process.argv.slice(2);
for (const q of qs) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=4&countrycodes=es&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'cantabria-places-map/0.2 (personal tool)' } });
  const j = await r.json();
  console.log('\n## ' + q);
  for (const x of j) console.log(`  ${(+x.lat).toFixed(5)}, ${(+x.lon).toFixed(5)}  [${x.category}/${x.type}]  ${x.display_name.slice(0, 110)}`);
  await new Promise(r => setTimeout(r, 1100));
}
