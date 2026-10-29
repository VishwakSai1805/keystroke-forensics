/** Weak-key drill: words weighted toward the user's worst keys and bigrams. Unranked. @module core/modes/weakkey */
import { createRng } from '../prng.js';
import { COMMON_WORDS } from '../corpus/words.js';
import { completeAtEnd } from './_shared.js';

/**
 * Score a word by how many weak characters and bigrams it exercises.
 * @param {string} word Word.
 * @param {{chars?:Object<string,number>, bigrams?:Object<string,number>}} weakness Weights in [0,1].
 * @returns {number}
 */
export function weaknessWeight(word, weakness) {
  let w = 0.05;
  const chars = weakness.chars || {};
  const bigrams = weakness.bigrams || {};
  for (let i = 0; i < word.length; i++) {
    w += chars[word[i]] || 0;
    if (i > 0) w += 2 * (bigrams[word.slice(i - 1, i + 1)] || 0);
  }
  return w;
}

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'weakkey',
  label: 'Weak keys',
  category: 'skill',
  defaults: { count: 30 },
  generate(seed, o, ctx = {}) {
    const rng = createRng(seed);
    const weakness = ctx.weakness || o.weakness || {};
    const weights = COMMON_WORDS.map((w) => weaknessWeight(w, weakness) ** 2);
    const n = Math.min(60, Math.max(10, Number(o.count) || 30));
    const out = [];
    for (let i = 0; i < n; i++) out.push(rng.weighted(COMMON_WORDS, weights));
    const focus = Object.entries(weakness.bigrams || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    return { text: out.join(' '), meta: { focus } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: false, minChars: 0, minAccuracy: 0, boardKey: () => 'weakkey' },
};
