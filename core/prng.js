/**
 * Seeded pseudo-random utilities. Deterministic across browsers, Node and Deno,
 * so the client and the server generate byte-identical text from one seed.
 * @module core/prng
 */

/**
 * mulberry32: a tiny 32-bit PRNG with good statistical quality for UI text generation.
 * @param {number} seed 32-bit unsigned integer seed.
 * @returns {() => number} Function returning floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * cyrb53 string hash folded to an unsigned 32-bit integer (usable as a seed).
 * @param {string} str Input string.
 * @param {number} [salt=0] Optional salt.
 * @returns {number} Unsigned 32-bit hash.
 */
export function hashString(str, salt = 0) {
  let h1 = 0xdeadbeef ^ salt;
  let h2 = 0x41c6ce57 ^ salt;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 & 0x1fffff) * 4294967296 + (h1 >>> 0)) >>> 0;
}

/**
 * Derive a child seed from a parent seed and a label (e.g. a chunk index).
 * @param {number} seed Parent seed.
 * @param {string|number} label Derivation label.
 * @returns {number} Child seed.
 */
export function deriveSeed(seed, label) {
  return hashString(`${seed >>> 0}:${label}`);
}

/**
 * Create an ergonomic RNG wrapper around mulberry32.
 * @param {number} seed Seed.
 * @returns {{next:()=>number,int:(n:number)=>number,pick:<T>(a:T[])=>T,shuffle:<T>(a:T[])=>T[],chance:(p:number)=>boolean,weighted:<T>(items:T[],weights:number[])=>T}}
 */
export function createRng(seed) {
  const next = mulberry32(seed);
  const int = (n) => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (arr) => arr[int(arr.length)],
    chance: (p) => next() < p,
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    weighted(items, weights) {
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return items[int(items.length)];
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i]);
        if (r < 0) return items[i];
      }
      return items[items.length - 1];
    },
  };
}

/**
 * UTC calendar day string (YYYY-MM-DD) for a timestamp.
 * @param {number} epochMs Milliseconds since epoch.
 * @returns {string}
 */
export function utcDay(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Seed shared by every player for the daily challenge of a given UTC day.
 * @param {string} day YYYY-MM-DD.
 * @returns {number}
 */
export function dailySeed(day) {
  return hashString(`daily:${day}`);
}

/**
 * Generate a random 32-bit seed using a CSPRNG when available.
 * @returns {number}
 */
export function randomSeed() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
