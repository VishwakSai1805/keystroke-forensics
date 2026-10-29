/**
 * Seeded text generation with pluggable per-mode providers and no repeats within a session.
 * @module core/textSource
 */
import { getMode, resolveOptions } from './modes/index.js';
import { deriveSeed, hashString, randomSeed } from './prng.js';

/** Modes whose text is fixed by their options, so repeat-avoidance does not apply. */
const FIXED = new Set(['daily', 'duel', 'custom']);

/**
 * Deterministically generate a mode's text from a seed.
 * @param {string} modeId Mode id.
 * @param {Object} options Mode options.
 * @param {number} seed Seed.
 * @param {Object} [ctx] Provider context (e.g. weakness weights).
 * @returns {{text:string, meta:Object}}
 */
export function generateText(modeId, options, seed, ctx = {}) {
  const mode = getMode(modeId);
  const gen = mode.generate(seed >>> 0, resolveOptions(modeId, options), ctx);
  return { text: gen.text, meta: gen.meta || {} };
}

/**
 * Create a session-scoped text source that never repeats a text within the session
 * (until a mode's pool is exhausted, after which it starts a fresh cycle).
 * @param {{sessionSeed?:number, maxAttempts?:number}} [opts]
 */
export function createTextSource(opts = {}) {
  const sessionSeed = opts.sessionSeed ?? randomSeed();
  const maxAttempts = opts.maxAttempts ?? 40;
  const used = new Map();
  let counter = 0;
  const bucket = (modeId) => {
    if (!used.has(modeId)) used.set(modeId, new Set());
    return used.get(modeId);
  };
  return {
    sessionSeed,
    /**
     * Next non-repeating text for a mode.
     * @param {string} modeId Mode id.
     * @param {Object} [options] Options.
     * @param {Object} [ctx] Context.
     * @returns {{seed:number, text:string, meta:Object}}
     */
    next(modeId, options = {}, ctx = {}) {
      const seen = bucket(modeId);
      let last = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const seed = deriveSeed(sessionSeed, counter++);
        const gen = generateText(modeId, options, seed, ctx);
        last = { seed, ...gen };
        const h = hashString(gen.text);
        if (FIXED.has(modeId) || !seen.has(h)) {
          seen.add(h);
          return last;
        }
      }
      seen.clear();
      seen.add(hashString(last.text));
      return last;
    },
    /** Record a text produced elsewhere (e.g. a server-issued run) as used. */
    markUsed(modeId, text) {
      bucket(modeId).add(hashString(text));
    },
    /** Whether a text has been used this session. */
    hasUsed(modeId, text) {
      return bucket(modeId).has(hashString(text));
    },
  };
}
