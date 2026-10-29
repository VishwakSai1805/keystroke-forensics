/**
 * Minimal QR Code encoder (ISO/IEC 18004): byte mode, error-correction level L,
 * versions 1-10 (up to 271 bytes), automatic mask selection. Zero dependencies.
 * @module client/qr
 */

// [ecCodewordsPerBlock, g1Blocks, g1DataCodewords, g2Blocks, g2DataCodewords] for level L.
const BLOCKS_L = [
  null,
  [7, 1, 19, 0, 0],
  [10, 1, 34, 0, 0],
  [15, 1, 55, 0, 0],
  [20, 1, 80, 0, 0],
  [26, 1, 108, 0, 0],
  [18, 2, 68, 0, 0],
  [20, 2, 78, 0, 0],
  [24, 2, 97, 0, 0],
  [30, 2, 116, 0, 0],
  [18, 2, 68, 2, 69],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const res = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ res.shift();
    res.push(0);
    for (let i = 0; i < degree; i++) res[i] ^= mul(gen[i + 1], factor);
  }
  return res;
}

const dataCapacity = (v) => {
  const [, b1, d1, b2, d2] = BLOCKS_L[v];
  return b1 * d1 + b2 * d2;
};

function bch(value, poly, bits) {
  let v = value << bits;
  const top = Math.floor(Math.log2(poly));
  for (let i = Math.floor(Math.log2(v)); i >= top; i--) if (v & (1 << i)) v ^= poly << (i - top);
  return (value << bits) | v;
}

/**
 * Encode text into a QR matrix.
 * @param {string} text Text (UTF-8 encoded in byte mode).
 * @returns {{size:number, modules:boolean[][]}}
 */
export function encodeQr(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const cc = v < 10 ? 8 : 16;
    if (4 + cc + bytes.length * 8 <= dataCapacity(v) * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('Text too long for QR versions 1-10');
  const cap = dataCapacity(version);
  const bits = [];
  const push = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);

  const [ec, b1, d1, b2, d2] = BLOCKS_L[version];
  const blocks = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2;
    const d = data.slice(k, k + len);
    k += len;
    blocks.push({ d, e: rsRemainder(d, ec) });
  }
  const codewords = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) codewords.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) codewords.push(b.e[i]);

  const size = 17 + version * 4;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    m[y][x] = dark;
    fn[y][x] = true;
  };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (let i = 0; i < size; i++) {
    if (!fn[6][i]) set(i, 6, i % 2 === 0);
    if (!fn[i][6]) set(6, i, i % 2 === 0);
  }
  const al = ALIGN[version];
  for (const ay of al) {
    for (const ax of al) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ay === 6 && ax === al[al.length - 1])) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // Reserve format areas and the dark module.
  for (let i = 0; i < 9; i++) {
    if (!fn[8][i]) set(i, 8, false);
    if (!fn[i][8]) set(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true);
  if (version >= 7) {
    const vi = bch(version, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const bit = ((vi >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // Zigzag data placement.
  const allBits = [];
  for (const c of codewords) for (let i = 7; i >= 0; i--) allBits.push((c >>> i) & 1);
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x]) {
          m[y][x] = bi < allBits.length ? allBits[bi] === 1 : false;
          bi++;
        }
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  const withMask = (mask) => {
    const out = m.map((row) => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) out[y][x] = !out[y][x];
    const fmt = bch((0b01 << 3) | mask, 0x537, 10) ^ 0x5412;
    const bit = (i) => ((fmt >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) out[i][8] = bit(i);
    out[7][8] = bit(6);
    out[8][8] = bit(7);
    out[8][7] = bit(8);
    for (let i = 9; i < 15; i++) out[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) out[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) out[size - 15 + i][8] = bit(i);
    out[size - 8][8] = true;
    return out;
  };

  const penalty = (g) => {
    let p = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          const cur = pass ? g[b][a] : g[a][b];
          const prev = pass ? g[b - 1][a] : g[a][b - 1];
          if (cur === prev) run++;
          else {
            if (run >= 5) p += run - 2;
            run = 1;
          }
        }
        if (run >= 5) p += run - 2;
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) p += 3;
    const pat = [true, false, true, true, true, false, true];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x + 7 <= size; x++) {
        const h = pat.every((v, i) => g[y][x + i] === v);
        const v = pat.every((val, i) => g[x + i][y] === val);
        if (h) p += 40;
        if (v) p += 40;
      }
    }
    let dark = 0;
    for (const row of g) for (const c of row) if (c) dark++;
    p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return p;
  };

  let best = null;
  let bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = withMask(mask);
    const p = penalty(g);
    if (p < bestP) {
      bestP = p;
      best = g;
    }
  }
  return { size, modules: best };
}

/**
 * Draw a QR code onto a 2D canvas context.
 * @param {CanvasRenderingContext2D} ctx Context.
 * @param {string} text Text.
 * @param {number} x Left.
 * @param {number} y Top.
 * @param {number} px Total size in pixels (including a 2-module quiet zone).
 * @param {{dark:string, light:string}} colors Colours.
 */
export function drawQr(ctx, text, x, y, px, colors) {
  const { size, modules } = encodeQr(text);
  const total = size + 4;
  const cell = px / total;
  ctx.fillStyle = colors.light;
  ctx.fillRect(x, y, px, px);
  ctx.fillStyle = colors.dark;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) ctx.fillRect(x + (c + 2) * cell, y + (r + 2) * cell, Math.ceil(cell), Math.ceil(cell));
}
