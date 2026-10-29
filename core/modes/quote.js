/** Quote mode: short / medium / long public-domain or original quotes. @module core/modes/quote */
import { createRng } from '../prng.js';
import { QUOTES } from '../corpus/quotes.js';
import { completeAtEnd, oneOf } from './_shared.js';

const len = (o) => oneOf(o.length, ['short', 'medium', 'long'], 'medium');

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'quote',
  label: 'Quote',
  category: 'skill',
  defaults: { length: 'medium' },
  generate(seed, o) {
    const pool = QUOTES[len(o)];
    const q = pool[createRng(seed).int(pool.length)];
    return { text: q.text, meta: { source: q.source, length: len(o) } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 30, minAccuracy: 90, boardKey: (o) => `quote:${len(o)}` },
};
