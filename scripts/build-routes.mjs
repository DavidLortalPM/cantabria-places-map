// Builds simplified route geometry from raw GPX files.
//   data/gpx/<hike-id>/*.gpx  ->  public/routes/<hike-id>.json + public/routes/index.json
// Run: node scripts/build-routes.mjs
// Plain Node ESM, no dependencies. GPX files are treated as untrusted text: regex-parsed only.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const gpxDir = path.join(root, 'data/gpx');
const outDir = path.join(root, 'public/routes');
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const TOL_M = 8;          // Douglas-Peucker tolerance (metres)
const MAX_POINTS = 500;   // if still above this, tolerance is raised in 2 m steps
const DEDUP_M = 2;        // drop points closer than this to the previous kept point
const CIRCULAR_M = 150;   // start/end closer than this = circular

// Per-hike metadata (source + page the GPX came from). Keyed by hike id.
// Several files can contribute (sources.json, sources.<name>.json) so parallel work does not collide; later files win.
const SOURCES = {};
for (const f of fs.readdirSync(gpxDir).filter(f => /^sources(..+)?.json$/.test(f)).sort()) Object.assign(SOURCES, JSON.parse(fs.readFileSync(path.join(gpxDir, f), 'utf8')));

const notion = JSON.parse(fs.readFileSync(path.join(root, 'data/hikes.notion.json'), 'utf8'));
const coords = JSON.parse(fs.readFileSync(path.join(root, 'data/hike-coords.json'), 'utf8'));
const byId = {};
for (const h of notion) byId[slug(h.Name)] = { notion: h, coord: coords[h.Name] };

function decode(buf) {
  const head = buf.subarray(0, 200).toString('latin1');
  const enc = (head.match(/encoding=["']([^"']+)["']/i) || [])[1] || 'utf-8';
  let text = new TextDecoder(/iso-8859-1|latin1/i.test(enc) ? 'windows-1252' : 'utf-8').decode(buf);
  return text.replace(/^﻿/, '');
}

function parseGpx(text) {
  const pts = [];
  // trackpoints and routepoints, in document order; segments are simply concatenated
  const re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[2];
    const lat = parseFloat((attrs.match(/\blat\s*=\s*["']([^"']+)["']/) || [])[1]);
    const lon = parseFloat((attrs.match(/\blon\s*=\s*["']([^"']+)["']/) || [])[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const ele = m[4] ? parseFloat((m[4].match(/<ele>\s*([^<\s]+)\s*<\/ele>/) || [])[1]) : NaN;
    pts.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  // prefer trackpoints if both exist (route points are then usually waypoints-as-route)
  const hasTrk = /<trkpt\b/.test(text);
  const kind = hasTrk ? 'trkpt' : 'rtept';
  const filtered = [];
  const re2 = new RegExp(`<${kind}\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${kind}>)`, 'g');
  while ((m = re2.exec(text))) {
    const lat = parseFloat((m[1].match(/\blat\s*=\s*["']([^"']+)["']/) || [])[1]);
    const lon = parseFloat((m[1].match(/\blon\s*=\s*["']([^"']+)["']/) || [])[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = m[3] ? parseFloat((m[3].match(/<ele>\s*([^<\s]+)\s*<\/ele>/) || [])[1]) : NaN;
    filtered.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  const names = [...text.matchAll(/<name>\s*(?:<!\[CDATA\[)?([^<\]]*)/g)].map(x => x[1].trim()).filter(Boolean).slice(0, 3);
  const nTrk = (text.match(/<trk>/g) || []).length, nSeg = (text.match(/<trkseg>/g) || []).length;
  return { pts: filtered, names, nTrk, nSeg, kind };
}

const R = 6371008.8;
const rad = d => d * Math.PI / 180;
function hav(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    if (!out.length || hav(out[out.length - 1], p) >= DEDUP_M) out.push(p);
  }
  // keep the true last point so the end is exact
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const lat0 = pts[0].lat;
  const kx = Math.cos(rad(lat0)) * R * Math.PI / 180, ky = R * Math.PI / 180;
  const xy = pts.map(p => [p.lon * kx, p.lat * ky]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let dmax = 0, idx = -1;
    const [x1, y1] = xy[s], [x2, y2] = xy[e];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      let d;
      if (len2 === 0) d = Math.hypot(xy[i][0] - x1, xy[i][1] - y1);
      else {
        let t = ((xy[i][0] - x1) * dx + (xy[i][1] - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        d = Math.hypot(xy[i][0] - (x1 + t * dx), xy[i][1] - (y1 + t * dy));
      }
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function ascent(pts) {
  const withEle = pts.filter(p => p.ele !== null);
  if (withEle.length < pts.length * 0.9 || withEle.length < 10) return null;
  // hysteresis of 5 m to ignore GPS/DEM noise
  let total = 0, ref = withEle[0].ele;
  for (const p of withEle) {
    if (p.ele - ref >= 5) { total += p.ele - ref; ref = p.ele; }
    else if (ref - p.ele >= 5) ref = p.ele;
  }
  return Math.round(total);
}

const r5 = n => Math.round(n * 1e5) / 1e5;
fs.mkdirSync(outDir, { recursive: true });
const index = {}, rows = [];

for (const id of fs.readdirSync(gpxDir).sort()) {
  const dir = path.join(gpxDir, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = fs.readdirSync(dir).filter(f => /\.gpx$/i.test(f)).sort();
  if (!files.length) continue;
  const src = SOURCES[id];
  if (!src) { console.warn(`! ${id}: no entry in data/gpx/sources*.json, skipped`); continue; }
  let raw = [], names = [], nTrk = 0, nSeg = 0;
  for (const f of files) {
    const p = parseGpx(decode(fs.readFileSync(path.join(dir, f))));
    raw = raw.concat(p.pts); names = names.concat(p.names); nTrk += p.nTrk; nSeg += p.nSeg;
  }
  if (raw.length < 2) { console.warn(`! ${id}: fewer than 2 points, skipped`); continue; }
  const full = dedupe(raw);
  let km = 0;
  for (let i = 1; i < full.length; i++) km += hav(full[i - 1], full[i]);
  km /= 1000;
  let tol = TOL_M, simp = simplify(full, tol);
  while (simp.length > MAX_POINTS) { tol += 2; simp = simplify(full, tol); }
  const lats = simp.map(p => p.lat), lons = simp.map(p => p.lon);
  const start = full[0], end = full[full.length - 1];
  const gap = hav(start, end);
  const asc = ascent(full);
  const rec = {
    id, name: src.name, source: src.source, sourceUrl: src.sourceUrl, ...(src.note ? { note: src.note } : {}),
    points: simp.map(p => [r5(p.lat), r5(p.lon)]),
    km: Math.round(km * 10) / 10,
    ...(asc !== null ? { ascentM: asc } : {}),
    bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)].map(r5),
    start: [r5(start.lat), r5(start.lon)], end: [r5(end.lat), r5(end.lon)],
    circular: gap < CIRCULAR_M,
  };
  const json = JSON.stringify(rec);
  fs.writeFileSync(path.join(outDir, `${id}.json`), json);
  index[id] = { km: rec.km, points: rec.points.length, source: rec.source, bytes: Buffer.byteLength(json) };

  const meta = byId[id];
  const nKm = meta?.notion['Distance (km)'] ?? null;
  const c = meta?.coord;
  rows.push({
    id, before: raw.length, deduped: full.length, after: simp.length, tol, km: rec.km, nKm,
    pct: nKm ? Math.round((km - nKm) / nKm * 100) : null,
    startOff: c ? Math.round(hav(start, { lat: c.lat, lon: c.lon })) : null,
    circ: rec.circular, notionType: meta?.notion['Route Type'] ?? null,
    gap: Math.round(gap), nTrk, nSeg, names: names.join(' / ').slice(0, 60), asc,
  });
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));

console.log('\nVALIDATION (tol = Douglas-Peucker metres; off = track start vs pinned trailhead)');
console.log(['id', 'pts raw>dedup>simp', 'tol', 'km', 'notion', 'diff%', 'off m', 'circ', 'notion type', 'trk/seg', 'gpx name'].join(' | '));
for (const r of rows) {
  const flags = [];
  if (r.pct !== null && Math.abs(r.pct) > 15) flags.push('KM?');
  if (r.startOff !== null && r.startOff > 300) flags.push('START>300m');
  if (r.notionType && /circular/i.test(r.notionType) !== r.circ && !/out and back/i.test(r.notionType)) flags.push('TYPE?');
  console.log([r.id, `${r.before}>${r.deduped}>${r.after}`, r.tol, r.km, r.nKm ?? '-', r.pct === null ? '-' : r.pct + '%',
    r.startOff ?? '-', r.circ ? 'circular' : `linear(gap ${r.gap}m)`, r.notionType ?? '-', `${r.nTrk}/${r.nSeg}`, r.names, flags.join(',')].join(' | '));
}
const total = Object.values(index).reduce((a, b) => a + b.bytes, 0);
console.log(`\n${rows.length} routes, ${(total / 1024).toFixed(1)} KB total in public/routes`);
