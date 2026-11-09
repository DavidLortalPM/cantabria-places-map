// Fetch OSM hiking relations (Overpass API) and write them as GPX 1.1 tracks.
//   node scripts/overpass-picos.mjs <hike-id>=<relation-id> [...]   -> data/gpx/<hike-id>/track.gpx
// Ways are chained in relation member order, each flipped so it joins the previous end; gaps are reported, not bridged.
// Data (c) OpenStreetMap contributors, ODbL. Response is treated as untrusted JSON (parsed only).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const UA = 'cantabria-places-map/0.3 (personal hobby project)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const R = 6371008.8, rad = d => d * Math.PI / 180;
const hav = (a, b) => { const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

async function fetchRel(id) {
  const q = `[out:json][timeout:60];relation(${id});out geom;`;
  // curl (not fetch): node's fetch does not pick up the local proxy settings here
  for (let attempt = 0; attempt < 4; attempt++) for (const ep of ENDPOINTS) {
    try {
      const out = execFileSync('curl', ['-s', '-G', '-m', '150', '--fail', '-A', UA, '--data-urlencode', 'data=' + q, ep], { encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'ignore'] });
      return JSON.parse(out);
    } catch (e) { console.warn(`  ${ep} -> failed (${String(e.message).split('\n')[0].slice(0, 80)})`); }
    await sleep(6000 * (attempt + 1));
  }
  throw new Error('all endpoints failed for ' + id);
}

// Join the relation's ways into one walking-order line. Member order in OSM relations is often not sequential,
// so build a graph on way end points and take the longest edge-simple trail (spurs/loops walked twice are not added).
export function chain(rel, P) {
  // role=alternative ways are variants, not the main line; ways listed twice stay as parallel edges (out-and-back spurs)
  let ways = rel.members.filter(m => m.type === 'way' && m.geometry && m.geometry.length > 1 && !/altern/i.test(m.role || ''))
    .map(m => m.geometry.map(g => ({ lat: g.lat, lon: g.lon })));
  if (!ways.length) return null;
  // end points closer than SNAP_M are treated as one junction (OSM relations often have small digitising gaps); the
  // joint is then a straight segment of at most SNAP_M between two real OSM vertices. Largest snap is reported.
  const SNAP_M = +(process.env.SNAP_M || 50), reps = []; let maxSnap = 0, nSnap = 0;
  const key = p => {
    for (const r of reps) { const d = hav(r, p); if (d < SNAP_M) { if (d > 0.5) { nSnap++; maxSnap = Math.max(maxSnap, d); } return r.k; } }
    const k = p.lat.toFixed(6) + ',' + p.lon.toFixed(6); reps.push({ lat: p.lat, lon: p.lon, k }); return k;
  };
  const len = w => { let m = 0; for (let i = 1; i < w.length; i++) m += hav(w[i - 1], w[i]); return m; };
  const adj = new Map();
  const add = (k, e) => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(e); };
  ways.forEach((w, i) => { const L = len(w); add(key(w[0]), { i, to: key(w[w.length - 1]), rev: false, L }); add(key(w[w.length - 1]), { i, to: key(w[0]), rev: true, L }); });
  // components
  const seen = new Set(); let comps = 0;
  for (const k0 of adj.keys()) { if (seen.has(k0)) continue; comps++; const st = [k0]; seen.add(k0); while (st.length) { const k = st.pop(); for (const e of adj.get(k)) if (!seen.has(e.to)) { seen.add(e.to); st.push(e.to); } } }
  const starts = [...adj.keys()].filter(k => adj.get(k).length === 1);
  let cand = starts.length ? starts : [...adj.keys()];
  if (!starts.length && P) { const near = cand.filter(k => { const [la, lo] = k.split(',').map(Number); return hav(P, { lat: la, lon: lo }) < 400; }); if (near.length) cand = near; }
  let best = { L: -1, trail: [] }, budget = 3e6;
  const used = new Set();
  function dfs(k, trail, L) {
    if (--budget < 0) return;
    let moved = false;
    for (const e of adj.get(k)) if (!used.has(e.i)) { moved = true; used.add(e.i); trail.push(e); dfs(e.to, trail, L + e.L); trail.pop(); used.delete(e.i); }
    if (!moved && L > best.L) best = { L, trail: trail.slice() };
  }
  for (const k of cand) { dfs(k, [], 0); if (budget < 0) break; }
  const pts = [];
  for (const e of best.trail) { const w = e.rev ? ways[e.i].slice().reverse() : ways[e.i]; pts.push(...(pts.length ? w.slice(1) : w)); }
  const total = ways.reduce((a, w) => a + len(w), 0);
  return { pts, gaps: [], nWays: ways.length, usedWays: best.trail.length, comps, ends: starts.length, unusedKm: Math.round((total - best.L) / 10) / 100, budgetHit: budget < 0, maxSnap: Math.round(maxSnap), nSnap };
}

function gpx(name, ref, relId, pts) {
  const seg = pts.map(p => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="cantabria-places-map overpass-picos.mjs" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><desc>OpenStreetMap relation ${relId} (c) OpenStreetMap contributors, ODbL</desc></metadata>\n<trk><name>${esc(ref ? ref + ' ' : '')}${esc(name)}</name><trkseg>\n${seg}\n</trkseg></trk>\n</gpx>\n`;
}

if (process.argv.length > 2) {
  const rawDir = process.env.RAW_DIR;
  for (const arg of process.argv.slice(2)) {
    const [hike, rest] = arg.split('='); const [relId, pin] = rest.split('@');
    console.log(`${hike} <- relation ${relId}`);
    const cache = rawDir && path.join(rawDir, `rel-${relId}.json`);
    let j; if (cache && fs.existsSync(cache)) j = JSON.parse(fs.readFileSync(cache, 'utf8')); else { try { j = await fetchRel(relId); } catch (e) { console.warn('  FETCH FAILED ' + hike); continue; } await sleep(5000); }
    const rel = j.elements.find(e => e.type === 'relation');
    if (!rel) { console.warn('  no relation'); continue; }
    if (cache) fs.writeFileSync(cache, JSON.stringify(j));
    const P0 = pin ? { lat: +pin.split(',')[0], lon: +pin.split(',')[1] } : null;
    const c = chain(rel, P0);
    if (!c) { console.warn('  no way geometry'); continue; }
    if (pin) {
      const [la, lo] = pin.split(',').map(Number); const P = { lat: la, lon: lo };
      if (c.ends === 0 && c.pts.length > 3 && hav(c.pts[0], c.pts[c.pts.length - 1]) < 3) { // closed loop: start the line at the vertex nearest the pin
        let bi = 0; c.pts.forEach((p, i) => { if (hav(P, p) < hav(P, c.pts[bi])) bi = i; });
        c.pts = c.pts.slice(bi).concat(c.pts.slice(1, bi + 1));
      } else if (hav(P, c.pts[c.pts.length - 1]) < hav(P, c.pts[0])) c.pts.reverse();
    }
        let m = 0; for (let i = 1; i < c.pts.length; i++) m += hav(c.pts[i - 1], c.pts[i]);
    console.log(`  ${rel.tags.ref || ''} "${rel.tags.name || ''}" ${c.nWays} ways, ${c.pts.length} pts, ${(m / 1000).toFixed(2)} km, comps ${c.comps}, ends ${c.ends}, used ${c.usedWays}/${c.nWays} ways, unused ${c.unusedKm} km${c.budgetHit ? ' BUDGET' : ''}, snaps ${c.nSnap} (max ${c.maxSnap} m), start ${c.pts[0].lat.toFixed(5)},${c.pts[0].lon.toFixed(5)} end ${c.pts[c.pts.length - 1].lat.toFixed(5)},${c.pts[c.pts.length - 1].lon.toFixed(5)}`);
    if (process.env.DRY) continue;
    const dir = path.join(root, 'data/gpx', hike);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'track.gpx'), gpx(rel.tags.name || '', rel.tags.ref, relId, c.pts));
  }
}
