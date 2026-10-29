/** Command mode: real shell / nmap / iptables / git commands. Reports a CLI-speed metric. @module core/modes/command */
import { createRng } from '../prng.js';
import { COMMANDS } from '../corpus/security.js';
import { completeAtEnd, oneOf } from './_shared.js';

const SETS = ['all', ...Object.keys(COMMANDS)];
const set = (o) => oneOf(o.set, SETS, 'all');

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'command',
  label: 'Commands',
  category: 'security',
  defaults: { set: 'all' },
  generate(seed, o) {
    const pool = set(o) === 'all' ? Object.values(COMMANDS).flat() : COMMANDS[set(o)];
    return { text: createRng(seed).shuffle(pool).slice(0, 5).join('\n'), meta: { set: set(o) } };
  },
  isComplete: completeAtEnd,
  /** CLI speed: correctly completed commands per minute. */
  extras({ text, typed, elapsedMs }) {
    const want = text.split('\n');
    const got = typed.split('\n');
    const done = want.filter((line, i) => got[i] === line).length;
    const minutes = elapsedMs / 60000;
    return { commandsCompleted: done, cliSpeed: minutes > 0 ? Math.round((done / minutes) * 10) / 10 : 0 };
  },
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: true, minChars: 60, minAccuracy: 90, boardKey: (o) => `command:${set(o)}` },
};
