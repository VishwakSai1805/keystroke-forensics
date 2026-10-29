/** Timed mode: fixed duration, text streams endlessly. @module core/modes/timed */
import { createRng, deriveSeed } from '../prng.js';
import { wordSequence, completeAtTime, oneOf } from './_shared.js';

export const DURATIONS = [15, 30, 60, 120];
const dur = (o) => oneOf(Number(o.duration), DURATIONS, 30);

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'timed',
  label: 'Timed',
  category: 'core',
  defaults: { duration: 30, punctuation: false, numbers: false },
  generate(seed, o) {
    return { text: wordSequence(createRng(deriveSeed(seed, 0)), 40, o), meta: { duration: dur(o) } };
  },
  extend(seed, chunk, o) {
    return ' ' + wordSequence(createRng(deriveSeed(seed, chunk)), 25, o);
  },
  durationMs: (o) => dur(o) * 1000,
  isComplete(view, now, o) {
    return completeAtTime(dur(o) * 1000)(view, now);
  },
  ui: { liveStats: true, timer: 'down' },
  scoreRules: {
    ranked: true,
    minChars: 30,
    minAccuracy: 90,
    boardKey: (o) => `timed:${dur(o)}${o.punctuation ? ':p' : ''}${o.numbers ? ':n' : ''}`,
  },
};
