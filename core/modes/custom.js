/** Custom text mode: user-supplied text, sanitized and length-limited. Unranked. @module core/modes/custom */
import { sanitizeText } from '../sanitize.js';
import { completeAtEnd } from './_shared.js';

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'custom',
  label: 'Custom',
  category: 'core',
  defaults: { text: '' },
  generate(_seed, o) {
    const text = sanitizeText(o.text || '');
    return { text: text || 'Paste some text in the custom box to practise it here.', meta: {} };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: false, minChars: 0, minAccuracy: 0, boardKey: () => 'custom' },
};
