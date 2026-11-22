// Builds public/data/details.<lang>.json: longer descriptions ("More details" in a place's sheet), one file per language.
// Inputs (all optional; missing files are skipped):
//   data/details/*.<lang>.json       translated CANTUR entries: [{ canturId, name, skip, summary, facts: [[label, value]], uncertain?, duplicateOf? }]
//   data/details.map.json            { "<canturId>": "<placeId>" }: which place in public/data/places.json an entry describes
//   data/details.extra.<lang>.json   hand-written entries: { "<placeId>": { summary, facts, sources: [{ label, url }] } }
//   data/source-links.json           sources registry; CANTUR entries link to the source 'cantur-pois-64'
// Merge rules: skip:true entries are dropped; a duplicateOf entry adds its facts to its target and the longer summary wins;
// an extra entry's summary wins over CANTUR's, facts and sources are added after CANTUR's.
// Output: { "<placeId>": { summary, facts, sources: [{ label, url }], uncertain? } }
// Usage: node scripts/build-details.mjs   (also run by npm run data)
import fs from 'node:fs';

const read = (f, fallback) => {
  if (!fs.existsSync(f)) return fallback;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.warn('warning: cannot parse', f, '-', e.message); return fallback; }
};
const DIR = 'data/details';
const CANTUR_SOURCE = 'cantur-pois-64';

const map = read('data/details.map.json', {});
const registry = read('data/source-links.json', { sources: [] });
const reg = Object.fromEntries((registry.sources || []).map(s => [s.id, s]));
const canturSrc = reg[CANTUR_SOURCE]?.url
  ? { label: reg[CANTUR_SOURCE].title.replace(/\s*\([^)]*\)\s*$/, ''), url: reg[CANTUR_SOURCE].url }
  : { label: 'CANTUR points of interest, Costa Central', url: 'https://cantur.net/santander/infoTools/views/gesPoi.php?idCat=64' };
const placeIds = new Set((read('public/data/places.json', { places: [] }).places || []).map(p => p.id));

// Languages = every <lang> seen in data/details/*.<lang>.json or data/details.extra.<lang>.json
const langFiles = {};
const addLang = (lang, f) => (langFiles[lang] ||= { cantur: [], extra: null }, f && langFiles[lang].cantur.push(f));
if (fs.existsSync(DIR)) for (const f of fs.readdirSync(DIR).sort()) { const m = f.match(/\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.json$/); if (m) addLang(m[1], DIR + '/' + f); }
for (const f of fs.existsSync('data') ? fs.readdirSync('data') : []) { const m = f.match(/^details\.extra\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.json$/); if (m) { addLang(m[1]); langFiles[m[1]].extra = 'data/' + f; } }

const clean = s => String(s ?? '').trim();
const cleanFacts = facts => (Array.isArray(facts) ? facts : [])
  .filter(f => Array.isArray(f) && clean(f[0]) && clean(f[1])).map(f => [clean(f[0]), clean(f[1])]);
const addFacts = (into, facts) => { for (const f of facts) if (!into.some(g => g[0] === f[0] && g[1] === f[1])) into.push(f); };
const addSources = (into, list) => {
  for (const s of Array.isArray(list) ? list : []) {
    const url = clean(s?.url);
    if (!/^https?:\/\//i.test(url)) continue;
    if (!into.some(t => t.url === url)) into.push({ label: clean(s.label) || url, url });
  }
};

fs.mkdirSync('public/data', { recursive: true });
for (const [lang, files] of Object.entries(langFiles)) {
  const out = {};
  const warn = (...a) => console.warn(`warning [${lang}]:`, ...a);
  const entry = id => (out[id] ||= { summary: '', facts: [], sources: [] });
  const entries = files.cantur.flatMap(f => { const a = read(f, []); if (!Array.isArray(a)) { warn(f, 'is not an array'); return []; } return a; })
    .filter(e => e && !e.skip && e.canturId != null);
  const byCantur = Object.fromEntries(entries.map(e => [String(e.canturId), e]));
  // primary entries first, so a duplicate always merges into an existing summary
  const ordered = [...entries.filter(e => e.duplicateOf == null), ...entries.filter(e => e.duplicateOf != null)];
  let unmapped = 0;
  for (const e of ordered) {
    const dup = e.duplicateOf != null ? String(e.duplicateOf) : null;
    const id = map[String(e.canturId)] || (dup && map[dup]);
    if (!id) { unmapped++; continue; }
    if (!placeIds.has(id)) { warn('cantur', e.canturId, '->', id, 'is not a place in public/data/places.json; left out'); continue; }
    if (dup && !byCantur[dup]) warn('cantur', e.canturId, 'is a duplicate of', dup, 'which is missing or skipped');
    const d = entry(id), summary = clean(e.summary);
    if (summary.length > d.summary.length) d.summary = summary;
    addFacts(d.facts, cleanFacts(e.facts));
    addSources(d.sources, [canturSrc]);
    if (e.uncertain && !d.uncertain) d.uncertain = typeof e.uncertain === 'string' ? clean(e.uncertain) : true;
  }
  const extra = files.extra ? read(files.extra, {}) : {};
  for (const [id, x] of Object.entries(extra || {})) {
    if (id.startsWith('_') || !x || typeof x !== 'object') continue;
    if (!placeIds.has(id)) { warn('extra entry', id, 'is not a place in public/data/places.json; left out'); continue; }
    const d = entry(id);
    if (clean(x.summary)) d.summary = clean(x.summary);
    addFacts(d.facts, cleanFacts(x.facts));
    addSources(d.sources, x.sources);
    if (x.uncertain) d.uncertain = typeof x.uncertain === 'string' ? clean(x.uncertain) : true;
  }
  for (const [id, d] of Object.entries(out)) if (!d.summary && !d.facts.length) delete out[id];
  const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
  fs.writeFileSync(`public/data/details.${lang}.json`, JSON.stringify(sorted, null, 1));
  console.log(`wrote public/data/details.${lang}.json: ${Object.keys(sorted).length} places` + (unmapped ? ` (${unmapped} CANTUR entries not in data/details.map.json yet)` : ''));
}
if (!Object.keys(langFiles).length) console.log('no details sources found (data/details/*.<lang>.json, data/details.extra.<lang>.json); nothing written');
console.log('languages:', Object.keys(langFiles).join(', ') || '-', '(the app lists its languages in LANGS in public/app.js)');
