// Helper: lists Wikipedia article candidates (es + en) for each place so titles can be chosen by hand into data/wiki.json.
import fs from 'node:fs';
const places = JSON.parse(fs.readFileSync('data/cultura.notion.json', 'utf8'));
const H = { headers: { 'User-Agent': 'cantabria-places-map/0.3 (personal tool)' } };
for (const p of places) {
  const q = p.name.replace(/\(.*?\)/g, '').trim();
  console.log('\n## ' + p.name);
  for (const lang of ['en', 'es']) {
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&srsearch=${encodeURIComponent(q + ' Cantabria')}`, H);
    const j = await r.json();
    console.log('  ' + lang + ': ' + (j.query?.search || []).map(s => s.title).join(' | '));
  }
}
