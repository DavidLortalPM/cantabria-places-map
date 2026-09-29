// Fetches Wikipedia summaries (image + extract) for hand-picked article titles in data/wiki-titles.json
// and writes data/wiki.json. Review the output; descriptions in data/descriptions.json are written by hand.
import fs from 'node:fs';
const titles = JSON.parse(fs.readFileSync('data/wiki-titles.json', 'utf8')); // { placeName: ["en:Title", "es:Title", ...] }
const H = { headers: { 'User-Agent': 'cantabria-places-map/0.3 (personal tool; david@productscope.uk)' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
for (const [name, cands] of Object.entries(titles)) {
  for (const c of cands) {
    const [lang, ...t] = c.split(':');
    const title = t.join(':');
    await sleep(700);
    const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, H);
    if (!r.ok) { console.log(`  ✗ ${name} <- ${c} (${r.status})`); continue; }
    const j = await r.json();
    console.log(`${j.thumbnail ? '📷' : '  '} ${name} <- ${c}\n     ${(j.extract || '').slice(0, 160)}`);
    out[name] ||= [];
    out[name].push({ lang, title: j.title, page: j.content_urls?.desktop?.page, image: j.thumbnail?.source || null, imageOrig: j.originalimage?.source || null, extract: j.extract });
  }
}
fs.writeFileSync('data/wiki.json', JSON.stringify(out, null, 1));
