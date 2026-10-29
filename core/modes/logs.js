/** Log and payload mode: SIEM-style log lines, hex strings, base64 strings. @module core/modes/logs */
import { generateLogLines, generatePayloads } from '../corpus/security.js';
import { completeAtEnd, oneOf } from './_shared.js';

const kind = (o) => oneOf(o.kind, ['siem', 'payload'], 'siem');

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'logs',
  label: 'Logs & payloads',
  category: 'security',
  defaults: { kind: 'siem' },
  generate(seed, o) {
    const lines = kind(o) === 'siem' ? generateLogLines(seed, 3) : generatePayloads(seed, 6);
    return { text: lines.join('\n'), meta: { kind: kind(o) } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 60, minAccuracy: 90, boardKey: (o) => `logs:${kind(o)}` },
};
