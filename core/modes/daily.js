/** Daily challenge: one seeded text for everyone per UTC day. @module core/modes/daily */
import { createRng, dailySeed, utcDay } from '../prng.js';
import { wordSequence, completeAtEnd } from './_shared.js';

const day = (o) => (/^\d{4}-\d{2}-\d{2}$/.test(o.day || '') ? o.day : utcDay(Date.now()));

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'daily',
  label: 'Daily',
  category: 'competitive',
  defaults: { day: '' },
  /** The seed argument is ignored: the UTC day alone determines the text. */
  generate(_seed, o) {
    const d = day(o);
    return { text: wordSequence(createRng(dailySeed(d)), 40, { punctuation: true }), meta: { day: d } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 40, minAccuracy: 90, boardKey: (o) => `daily:${day(o)}` },
};
