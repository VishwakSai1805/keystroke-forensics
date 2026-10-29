/** Sudden death: the first mistake ends the run. @module core/modes/suddendeath */
import { createRng } from '../prng.js';
import { wordSequence, completeAtEnd } from './_shared.js';

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'sudden',
  label: 'Sudden death',
  category: 'skill',
  defaults: {},
  failOnError: true,
  generate(seed) {
    return { text: wordSequence(createRng(seed), 50), meta: {} };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 40, minAccuracy: 90, boardKey: () => 'sudden' },
};
