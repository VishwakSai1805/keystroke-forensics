/** Reverse and scrambled words: breaks muscle-memory autopilot. @module core/modes/scrambled */
import { createRng } from '../prng.js';
import { COMMON_WORDS } from '../corpus/words.js';
import { completeAtEnd, oneOf } from './_shared.js';

const variant = (o) => oneOf(o.variant, ['scramble', 'reverse'], 'scramble');

/**
 * Shuffle the inner letters of a word (first and last letters stay put).
 * @param {string} w Word.
 * @param {ReturnType<import('../prng.js').createRng>} rng RNG.
 * @returns {string}
 */
export function scrambleWord(w, rng) {
  if (w.length < 4) return w.split('').reverse().join('');
  const inner = w.slice(1, -1).split('');
  for (let tries = 0; tries < 5; tries++) {
    const s = rng.shuffle(inner).join('');
    if (s !== inner.join('')) return w[0] + s + w[w.length - 1];
  }
  return w[0] + inner.reverse().join('') + w[w.length - 1];
}

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'scrambled',
  label: 'Scrambled',
  category: 'skill',
  defaults: { variant: 'scramble' },
  generate(seed, o) {
    const rng = createRng(seed);
    const v = variant(o);
    const words = [];
    for (let i = 0; i < 25; i++) {
      const w = rng.pick(COMMON_WORDS);
      words.push(v === 'reverse' ? w.split('').reverse().join('') : scrambleWord(w, rng));
    }
    return { text: words.join(' '), meta: { variant: v } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 40, minAccuracy: 90, boardKey: (o) => `scrambled:${variant(o)}` },
};
