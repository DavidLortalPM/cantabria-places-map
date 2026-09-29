// Generates the home-screen icons (green square with a white map pin) with no dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
const chunk = (type, data) => {
  const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2, cy = size * 0.42, R = size * 0.24, hole = size * 0.09;
  const tipY = size * 0.80;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const inCircle = dx * dx + dy * dy <= R * R;
      // teardrop: triangle from circle tangents down to tip
      const t = (y - cy) / (tipY - cy);
      const inTip = y > cy && y < tipY && Math.abs(dx) <= R * (1 - t) * 0.95;
      const inHole = dx * dx + dy * dy <= hole * hole;
      const pin = (inCircle || inTip) && !inHole;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const [r, g, b] = pin ? [255, 255, 255] : [0x1f, 0x4d, 0x3a];
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [180, 512]) fs.writeFileSync(`public/icon-${s}.png`, icon(s));
console.log('icons written');
