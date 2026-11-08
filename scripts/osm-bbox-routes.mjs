// Fallback discovery when Overpass is down: list hiking/foot route relations touching a bbox via OSM API 0.6 /map (small bbox only).
//   node scripts/osm-bbox-routes.mjs <west,south,east,north>
const UA = 'cantabria-places-map/0.3 (personal hobby project)';
const r = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${process.argv[2]}`, { headers: { 'User-Agent': UA } });
if (!r.ok) { console.log('HTTP', r.status); process.exit(1); }
const j = await r.json();
for (const e of j.elements) if (e.type === 'relation' && /hiking|foot|walking/.test(e.tags?.route || '')) console.log(e.id, '|', e.tags.ref || '-', '|', e.tags.name || '-', '|', e.tags.network || '-', '|', e.tags.distance || '-');
console.log('elements', j.elements.length);
