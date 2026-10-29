/** Sentence mode: the original spec. One sentence; finish it to complete. @module core/modes/sentence */
import { createRng } from '../prng.js';
import { SENTENCES } from '../corpus/sentences.js';
import { completeAtEnd } from './_shared.js';

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'sentence',
  label: 'Sentence',
  category: 'core',
  defaults: {},
  generate(seed) {
    const rng = createRng(seed);
    return { text: SENTENCES[rng.int(SENTENCES.length)], meta: {} };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 40, minAccuracy: 90, boardKey: () => 'sentence' },
};
