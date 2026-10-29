/** Blind mode: typed characters hidden; errors revealed at the end. @module core/modes/blind */
import { createRng } from '../prng.js';
import { wordSequence, completeAtEnd } from './_shared.js';

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'blind',
  label: 'Blind',
  category: 'skill',
  defaults: {},
  generate(seed) {
    return { text: wordSequence(createRng(seed), 25), meta: {} };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up', hideTyped: true },
  scoreRules: { ranked: true, minChars: 40, minAccuracy: 90, boardKey: () => 'blind' },
};
