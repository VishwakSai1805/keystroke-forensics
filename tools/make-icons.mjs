// Renders the PWA icons (amber recorder lamp on warm black) as PNGs with no dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x0e, 0x0d, 0x0b];
const AMBER = [0xff, 0xb0, 0x00];
const TEAL = [0x4f, 0xb3, 0xa9];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = paint(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Supersampled shape coverage. */
function paintIcon(maskable) {
  return (x, y, size) => {
    const S = 4;
    let ring = 0;
    let dot = 0;
    let bar = 0;
    const scale = maskable ? 0.72 : 0.9;
    for (let sy = 0; sy < S; sy++) {
      for (let sx = 0; sx < S; sx++) {
        const u = ((x + (sx + 0.5) / S) / size - 0.5) / scale;
        const v = ((y + (sy + 0.5) / S) / size - 0.5) / scale;
        const r = Math.hypot(u, v);
        if (r > 0.36 && r < 0.43) ring++;
        if (Math.hypot(u, v + 0.09) < 0.08) dot++;
        if (Math.abs(v - 0.13) < 0.022 && Math.abs(u) < 0.22 && Math.abs(u) > 0.02) bar++;
      }
    }
    const n = S * S;
    let c = BG;
    c = mix(c, AMBER, ring / n);
    c = mix(c, AMBER, dot / n);
    c = mix(c, TEAL, bar / n);
    return [...c, 255];
  };
}

mkdirSync('vanilla/assets/icons', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`vanilla/assets/icons/icon-${size}.png`, png(size, paintIcon(false)));
  writeFileSync(`vanilla/assets/icons/maskable-${size}.png`, png(size, paintIcon(true)));
}
writeFileSync('vanilla/assets/icons/apple-touch-icon.png', png(180, paintIcon(true)));
console.log('icons written');
