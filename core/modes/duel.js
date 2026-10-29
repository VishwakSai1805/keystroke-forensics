/** Duel: 1v1 race. Both players derive the same text from the room code. @module core/modes/duel */
import { createRng, hashString } from '../prng.js';
import { wordSequence, completeAtEnd } from './_shared.js';

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'duel',
  label: 'Duel',
  category: 'competitive',
  defaults: { room: '' },
  generate(_seed, o) {
    return { text: wordSequence(createRng(hashString(`duel:${o.room}`)), 30), meta: { room: o.room } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: false, minChars: 0, minAccuracy: 0, boardKey: () => 'duel' },
};
