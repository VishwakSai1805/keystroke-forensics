/** Code mode: real snippets with brackets, symbols and indentation. Per-language boards. @module core/modes/code */
import { createRng } from '../prng.js';
import { CODE_SNIPPETS, CODE_LANGUAGES } from '../corpus/code.js';
import { completeAtEnd, oneOf } from './_shared.js';

const lang = (o) => oneOf(o.language, CODE_LANGUAGES, 'javascript');

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'code',
  label: 'Code',
  category: 'skill',
  defaults: { language: 'javascript' },
  autoIndent: true,
  generate(seed, o) {
    const pool = CODE_SNIPPETS[lang(o)];
    return { text: pool[createRng(seed).int(pool.length)], meta: { language: lang(o) } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 50, minAccuracy: 90, boardKey: (o) => `code:${lang(o)}` },
};
