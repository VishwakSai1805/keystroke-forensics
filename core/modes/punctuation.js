/** Punctuation and numbers mode: capitals, digits and symbols injected. @module core/modes/punctuation */
import { createRng } from '../prng.js';
import { wordSequence, completeAtEnd, oneOf } from './_shared.js';

const cnt = (o) => oneOf(Number(o.count), [25, 50], 25);

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'punctuation',
  label: 'Punctuation',
  category: 'skill',
  defaults: { count: 25 },
  generate(seed, o) {
    return { text: wordSequence(createRng(seed), cnt(o), { punctuation: true, numbers: true }), meta: {} };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 40, minAccuracy: 90, boardKey: (o) => `punctuation:${cnt(o)}` },
};
