/**
 * Mode registry. Every mode implements the common Mode interface (see _shared.js).
 * @module core/modes
 */
import sentence from './sentence.js';
import timed from './timed.js';
import words from './words.js';
import custom from './custom.js';
import code from './code.js';
import punctuation from './punctuation.js';
import quote from './quote.js';
import weakkey from './weakkey.js';
import blind from './blind.js';
import sudden from './suddendeath.js';
import zen from './zen.js';
import scrambled from './scrambled.js';
import daily from './daily.js';
import duel from './duel.js';
import command from './command.js';
import logs from './logs.js';
import phishing from './phishing.js';
import lesson from './lesson.js';

const ALL = [sentence, timed, words, custom, code, punctuation, quote, weakkey, blind, sudden, zen, scrambled, daily, duel, command, logs, phishing, lesson];

/** @type {Map<string, import('./_shared.js').Mode>} */
export const MODES = new Map(ALL.map((m) => [m.id, m]));

/**
 * Look up a mode; throws on unknown ids so typos fail loudly.
 * @param {string} id Mode id.
 * @returns {import('./_shared.js').Mode}
 */
export function getMode(id) {
  const m = MODES.get(id);
  if (!m) throw new Error(`Unknown mode: ${id}`);
  return m;
}

/**
 * List modes, optionally by category.
 * @param {string} [category] Category filter.
 * @returns {import('./_shared.js').Mode[]}
 */
export function listModes(category) {
  return ALL.filter((m) => !category || m.category === category);
}

/**
 * Merge user options over mode defaults.
 * @param {string} id Mode id.
 * @param {Object} [options] Options.
 * @returns {Object}
 */
export function resolveOptions(id, options = {}) {
  return { ...getMode(id).defaults, ...options };
}

/**
 * Leaderboard partition key. Never mixes modes or option variants.
 * @param {string} id Mode id.
 * @param {Object} [options] Options.
 * @returns {string}
 */
export function boardKey(id, options = {}) {
  return getMode(id).scoreRules.boardKey(resolveOptions(id, options));
}

export { scorePhishing, phishingScore, createPhishingSession } from './phishing.js';
