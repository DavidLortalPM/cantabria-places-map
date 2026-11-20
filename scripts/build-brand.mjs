// Brand assets from one SVG pin: favicon.ico, icon.svg, PNG icons (180/192/512) and the og.jpg link-preview card.
// Usage: npm run brand   (writes into public/; regenerate on Windows so og.jpg keeps Segoe UI; bump og:image ?v= in index.html when it changes)
import { writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
const OUT = process.argv[2] || 'public';
mkdirSync(OUT, { recursive: true });

const GREEN = '#1f4d3a';
// The pin from the existing icon, on a 512 grid
const PIN = `<path fill="#fff" fill-rule="evenodd" d="M256 92a124 124 0 0 0-50 237.5L256 412l50-82.5A124 124 0 0 0 256 92Zm0 77a46 46 0 1 1 0 92a46 46 0 0 1 0-92Z"/>`;

// Favicon SVG: rounded square so it reads as an app tile in tabs (works on light and dark tab strips)
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${GREEN}"/>${PIN}</svg>`;
// Full-bleed square for apple-touch / manifest (OS applies its own mask)
const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${GREEN}"/>${PIN}</svg>`;
writeFileSync(`${OUT}/icon.svg`, iconSvg);

for (const [name, size, svg] of [['icon-180.png', 180, tileSvg], ['icon-192.png', 192, tileSvg], ['icon-512.png', 512, tileSvg]]) {
  await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9, palette: true }).toFile(`${OUT}/${name}`);
}

// favicon.ico = ICO header wrapping one 32x32 PNG (valid since Windows Vista; all browsers accept it)
const png32 = await sharp(Buffer.from(iconSvg), { density: 300 }).resize(32, 32).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);       // reserved, type=icon, count=1
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt8(0, 8); ico.writeUInt8(0, 9); // w, h, colours, reserved
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);                              // planes, bpp
ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);                  // size, offset
writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([ico, png32]));

// og.jpg 1200x630: centred so WhatsApp's square crop (middle 630x630) still shows pin + name
const cats = [['Hikes', '#2f855a'], ['Walks', '#0e7490'], ['Family', '#2b6cb0'], ['Culture', '#805ad5'], ['Food', '#c53030']];
const contours = Array.from({ length: 9 }, (_, i) => {
  const r = 120 + i * 70;
  return `<ellipse cx="${940 + i * 6}" cy="${560 - i * 4}" rx="${r * 1.35}" ry="${r}" fill="none" stroke="#fff" stroke-opacity="${0.07 - i * 0.004}" stroke-width="2"/>` +
         `<ellipse cx="${230 - i * 5}" cy="${60 + i * 3}" rx="${r * 1.2}" ry="${r * 0.8}" fill="none" stroke="#fff" stroke-opacity="${0.06 - i * 0.004}" stroke-width="2"/>`;
}).join('');
const chipW = 150, gap = 14, total = cats.length * chipW + (cats.length - 1) * gap, x0 = (1200 - total) / 2;
const chips = cats.map(([t, c], i) => {
  const x = x0 + i * (chipW + gap);
  return `<rect x="${x}" y="452" width="${chipW}" height="52" rx="26" fill="#fff" fill-opacity=".1" stroke="#fff" stroke-opacity=".25"/>` +
         `<circle cx="${x + 30}" cy="478" r="9" fill="${c}" stroke="#fff" stroke-width="2.5"/>` +
         `<text x="${x + 48}" y="487" font-size="25" font-weight="600" fill="#fff">${t}</text>`;
}).join('');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#2a6a50"/><stop offset="1" stop-color="#173b2c"/></radialGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>${contours}
  <g transform="translate(535 52) scale(.255)">${PIN}</g>
  <g font-family="Segoe UI, Helvetica, Arial, sans-serif" text-anchor="middle" fill="#fff">
    <text x="600" y="232" font-size="30" font-weight="600" letter-spacing="6" fill-opacity=".75">COAST · VALLEYS · PICOS DE EUROPA</text>
    <text x="600" y="330" font-size="92" font-weight="700">Cantabria Map</text>
    <text x="600" y="395" font-size="34" fill-opacity=".85">Hand-picked places to walk, explore and eat</text>
  </g>
  <g font-family="Segoe UI, Helvetica, Arial, sans-serif">${chips}</g>
  <text x="600" y="585" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="24" fill="#fff" fill-opacity=".6">explorecantabria.fyi</text>
</svg>`;
await sharp(Buffer.from(og)).jpeg({ quality: 82, mozjpeg: true }).toFile(`${OUT}/og.jpg`);
console.log('wrote icon.svg, favicon.ico, icon-180/192/512.png, og.jpg to', OUT);
