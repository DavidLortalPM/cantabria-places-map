// Helper: search Wikimedia Commons for photos; prints file title, thumb URL and licence for hand selection.
const H = { headers: { 'User-Agent': 'cantabria-places-map/0.3 (personal tool; david@productscope.uk)' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const q of process.argv.slice(2)) {
  await sleep(800);
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=6&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640`;
  const j = await (await fetch(u, H)).json();
  console.log('\n## ' + q);
  for (const p of Object.values(j.query?.pages || {})) {
    const ii = p.imageinfo?.[0]; const m = ii?.extmetadata || {};
    console.log(`  ${p.title}\n     ${ii?.thumburl}\n     ${m.LicenseShortName?.value} | ${(m.Artist?.value || '').replace(/<[^>]+>/g, '').slice(0, 50)}`);
  }
}
