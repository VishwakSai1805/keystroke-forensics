/**
 * Helpers shared by mode modules.
 * @module core/modes/_shared
 */
import { COMMON_WORDS } from '../corpus/words.js';

/**
 * @typedef {Object} ModeView
 * @property {number} typedLength Characters currently in the input.
 * @property {number} textLength Length of the target text.
 * @property {number|null} startT performance.now() of the first keystroke.
 * @property {number} mismatches Uncorrected errors currently in the input.
 */

/**
 * @typedef {Object} Mode
 * @property {string} id Stable identifier.
 * @property {string} label Human label.
 * @property {'core'|'skill'|'competitive'|'security'|'learning'} category Grouping.
 * @property {Object} defaults Default options.
 * @property {(seed:number, options:Object, ctx?:Object)=>{text:string, meta?:Object}} generate Seeded text provider.
 * @property {(seed:number, chunk:number, options:Object)=>string} [extend] Streaming text provider (timed modes).
 * @property {(view:ModeView, now:number, options:Object)=>boolean} isComplete Completion predicate.
 * @property {(options:Object)=>number|null} [durationMs] Fixed duration for timed modes.
 * @property {boolean} [failOnError] End the run on the first mistake (sudden death).
 * @property {boolean} [autoIndent] Auto-insert indentation after a correct newline.
 * @property {{hideTyped?:boolean, liveStats?:boolean, timer?:'up'|'down'|'none'}} ui UI hints.
 * @property {{ranked:boolean, minChars:number, minAccuracy:number, boardKey:(options:Object)=>string}} scoreRules Leaderboard rules.
 * @property {(ctx:{text:string, typed:string, elapsedMs:number})=>Object} [extras] Mode-specific metrics.
 */

/** Completion when the whole target has been typed. */
export const completeAtEnd = (view) => view.textLength > 0 && view.typedLength >= view.textLength;

/** Completion for timed modes. */
export const completeAtTime = (durationMs) => (view, now) => view.startT !== null && now - view.startT >= durationMs;

/**
 * Seeded word sequence with optional capitals, punctuation and numbers.
 * @param {ReturnType<import('../prng.js').createRng>} rng RNG.
 * @param {number} n Word count.
 * @param {{punctuation?:boolean, numbers?:boolean, pool?:string[]}} [opts]
 * @returns {string}
 */
export function wordSequence(rng, n, opts = {}) {
  const { punctuation = false, numbers = false, pool = COMMON_WORDS } = opts;
  const out = [];
  let capNext = punctuation;
  let prev = '';
  for (let i = 0; i < n; i++) {
    let w;
    if (numbers && rng.chance(0.12)) {
      w = String(rng.int(rng.chance(0.5) ? 100 : 10000));
    } else {
      do w = rng.pick(pool);
      while (w === prev && pool.length > 1);
    }
    prev = w;
    if (punctuation) {
      if (capNext && /^[a-z]/.test(w)) w = w[0].toUpperCase() + w.slice(1);
      capNext = false;
      const r = rng.next();
      if (r < 0.08) {
        w += '.';
        capNext = true;
      } else if (r < 0.14) w += ',';
      else if (r < 0.16) {
        w += '?';
        capNext = true;
      } else if (r < 0.17) {
        w += '!';
        capNext = true;
      } else if (r < 0.19) w = `"${w}"`;
      else if (r < 0.21) w = `(${w})`;
      else if (r < 0.22) w += ';';
      else if (r < 0.23) w += ':';
      else if (r < 0.24) w += '-' + rng.pick(pool);
    }
    out.push(w);
  }
  let text = out.join(' ');
  if (punctuation && !/[.?!]$/.test(text)) text += '.';
  return text;
}

/** Clamp a numeric option into an allowed set, falling back to a default. */
export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
