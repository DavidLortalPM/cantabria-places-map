// Downloads one Wikimedia Commons photo per place into public/img/ and records licence + credit in data/images.json.
// Photo choice: data/images-override.json (place name -> "File:...") wins, otherwise the lead image of the first
// Wikipedia article in data/wiki.json that has one. Usage: node scripts/fetch-images.mjs
import fs from 'node:fs';

const H = { headers: { 'User-Agent': 'cantabria-places-map/0.3 (personal tool; david@productscope.uk)' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const wiki = JSON.parse(fs.readFileSync('data/wiki.json', 'utf8'));
const override = JSON.parse(fs.readFileSync('data/images-override.json', 'utf8'));
const skip = new Set(Object.keys(override).filter(k => override[k] === null));

const chosen = {};
for (const name of Object.keys(JSON.parse(fs.readFileSync('data/wiki-titles.json', 'utf8')))) {
  if (skip.has(name)) continue;
  if (override[name]) { chosen[name] = override[name]; continue; }
  const hit = (wiki[name] || []).find(w => w.imageOrig);
  if (hit) {
    const u = hit.imageOrig.split('?')[0].split('/'); // thumb URLs keep the real file name one segment before the end
    chosen[name] = 'File:' + decodeURIComponent(u.includes('thumb') ? u[u.length - 2] : u.pop());
  }
}

fs.mkdirSync('public/img', { recursive: true });
const out = {};
for (const [name, file] of Object.entries(chosen)) {
  await sleep(800);
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&titles=${encodeURIComponent(file)}`;
  const j = await (await fetch(api, H)).json();
  const ii = Object.values(j.query.pages)[0].imageinfo?.[0];
  if (!ii) { console.log('✗ no imageinfo', name, file); continue; }
  const m = ii.extmetadata || {};
  const strip = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  await sleep(800);
  const img = await fetch(ii.thumburl, H);
  if (!img.ok) { console.log('✗ download', img.status, name); continue; }
  const path = `img/${slug(name)}.jpg`;
  fs.writeFileSync('public/' + path, Buffer.from(await img.arrayBuffer()));
  out[name] = { src: '/' + path, credit: strip(m.Artist?.value) || 'Unknown', license: m.LicenseShortName?.value || '', page: ii.descriptionurl };
  console.log('✓', name, '<-', file, '|', out[name].license, '|', out[name].credit.slice(0, 40));
}
fs.writeFileSync('data/images.json', JSON.stringify(out, null, 1));
