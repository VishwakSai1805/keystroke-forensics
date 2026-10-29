/** Word-count mode: fixed length, race to finish. @module core/modes/words */
import { createRng } from '../prng.js';
import { wordSequence, completeAtEnd, oneOf } from './_shared.js';

export const COUNTS = [10, 25, 50, 100];
const cnt = (o) => oneOf(Number(o.count), COUNTS, 25);

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'words',
  label: 'Words',
  category: 'core',
  defaults: { count: 25 },
  generate(seed, o) {
    return { text: wordSequence(createRng(seed), cnt(o)), meta: { count: cnt(o) } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 40, minAccuracy: 90, boardKey: (o) => `words:${cnt(o)}` },
};
