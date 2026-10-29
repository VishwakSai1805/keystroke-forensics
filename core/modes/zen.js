/** Zen mode: no timer or live stats; results only at the end. Unranked. @module core/modes/zen */
import { createRng } from '../prng.js';
import { SENTENCES } from '../corpus/sentences.js';
import { completeAtEnd } from './_shared.js';

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'zen',
  label: 'Zen',
  category: 'skill',
  defaults: {},
  generate(seed) {
    const rng = createRng(seed);
    return { text: rng.shuffle(SENTENCES).slice(0, 3).join(' '), meta: {} };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: false, timer: 'none' },
  scoreRules: { ranked: false, minChars: 0, minAccuracy: 0, boardKey: () => 'zen' },
};
