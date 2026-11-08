// Fetch OSM hiking route relations via Overpass and write GPX 1.1 (ODbL, (c) OpenStreetMap contributors).
//   node scripts/overpass-cantabria.mjs list <south,west,north,east>
//   node scripts/overpass-cantabria.mjs gpx <relationId> <hike-id>
// Rate limit: >= 6 s between requests. Data is treated as untrusted JSON.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const UA = 'cantabria-places-map/0.3 (personal hobby project)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const R = 6371008.8, rad = d => d * Math.PI / 180;
const hav = (a, b) => { const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
async function query(q) {
 for (let attempt = 0; attempt < 3; attempt++) {
  for (const ep of ENDPOINTS) {
    try {
      const r = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (r.ok) { await new Promise(s => setTimeout(s, 6000)); return await r.json(); }
      console.error(ep, r.status);
    } catch (e) { console.error(ep, e.message); }
    await new Promise(s => setTimeout(s, 6000));
  }
  }
  throw new Error("overpass failed");
}
// Fallback when Overpass is down: OSM API 0.6 relation/full (single small request), converted to the "out geom" shape.
async function viaOsmApi(id) {
  const r = await fetch(`https://api.openstreetmap.org/api/0.6/relation/${id}/full.json`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('osm api ' + r.status);
  const j = await r.json(); const nodes = {}, ways = {}; let rel;
  for (const e of j.elements) { if (e.type === 'node') nodes[e.id] = e; else if (e.type === 'way') ways[e.id] = e; else if (e.type === 'relation' && e.id == id) rel = e; }
  rel.members = rel.members.map(m => m.type === 'way' && ways[m.ref] ? { ...m, geometry: ways[m.ref].nodes.map(n => nodes[n]).filter(Boolean).map(n => ({ lat: n.lat, lon: n.lon })) } : m);
  return { elements: [rel] };
}
const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'list') {
  const j = await query(`[out:json][timeout:60];(relation["route"~"hiking|foot|walking"](${a});relation["route"="mtb"]["name"](${a}););out tags bb;`);
  for (const e of j.elements) console.log(e.id, '|', e.tags.route, '|', e.tags.ref || '-', '|', e.tags.name || '-', '|', e.tags.network || '-', '|', e.tags.distance || '-', '|', e.tags.from || '', '->', e.tags.to || '');
} else if (cmd === 'gpx') {
  const j = process.env.RAWIN ? JSON.parse(fs.readFileSync(process.env.RAWIN, 'utf8')) : process.env.OSMAPI ? await viaOsmApi(a) : await query(`[out:json][timeout:90];relation(${a});out geom;`);
  const rel = j.elements[0]; if (process.env.RAWOUT) fs.writeFileSync(process.env.RAWOUT, JSON.stringify(j));
  const ways = rel.members.filter(m => m.type === 'way' && m.geometry && m.geometry.length > 1 && !/^(platform|stop)/.test(m.role)).map(m => m.geometry.map(p => ({ lat: p.lat, lon: p.lon })));
  // greedy chain in member order; flip ways as needed; report gaps
  let line = ways[0].slice(); const gaps = []; const used = new Set([0]);
  while (used.size < ways.length) {
    const end = line[line.length - 1], start = line[0];
    let best = null;
    ways.forEach((w, i) => { if (used.has(i)) return;
      for (const [d, where, rev] of [[hav(end, w[0]), 'end', false], [hav(end, w[w.length - 1]), 'end', true], [hav(start, w[w.length - 1]), 'start', false], [hav(start, w[0]), 'start', true]])
        if (!best || d < best.d) best = { d, i, where, rev }; });
    const w = ways[best.i].slice(); used.add(best.i);
    if (best.d > 15) { gaps.push('omitted-disconnected-way:' + Math.round(best.d) + 'm'); continue; } // never bridge gaps
    if (best.where === 'end') line = line.concat(best.rev ? w.reverse() : w); else line = (best.rev ? w.reverse() : w).concat(line);
  }
  if (process.env.PIN && hav(line[0], line[line.length - 1]) < 15) { // closed loop: rotate so it starts nearest the trailhead pin
    const [pl, po] = process.env.PIN.split(',').map(Number); let bi = 0, bd = 1e9;
    line.forEach((p, i) => { const d = hav(p, { lat: pl, lon: po }); if (d < bd) { bd = d; bi = i; } });
    line = line.slice(bi).concat(line.slice(1, bi + 1));
  }
  let km = 0; for (let i = 1; i < line.length; i++) km += hav(line[i - 1], line[i]);
  const t = rel.tags;
  console.log(`rel ${a} "${t.name}" ref=${t.ref} ways=${ways.length} km=${(km / 1000).toFixed(2)} osm-distance=${t.distance} gaps>15m=${JSON.stringify(gaps)} start=${line[0].lat},${line[0].lon}`);
  if (b) {
    const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="overpass-cantabria.mjs" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(t.name || b)}</name><copyright author="OpenStreetMap contributors"><license>https://www.openstreetmap.org/copyright</license></copyright><link href="https://www.openstreetmap.org/relation/${a}"/></metadata>\n<trk><name>${esc(t.name || b)}</name><trkseg>\n${line.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"/>`).join('\n')}\n</trkseg></trk>\n</gpx>\n`;
    const dir = path.join(root, 'data/gpx', b); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'track.gpx'), gpx);
    console.log('written', b);
  }
}
