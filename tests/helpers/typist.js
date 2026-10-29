/**
 * Synthetic typists for tests: a human-like one (jittered intervals and dwell) and bots.
 */
import { createEngine } from '../../core/engine.js';
import { createRng } from '../../core/prng.js';

const codeFor = (ch) => (ch === ' ' ? 'Space' : ch === '\n' ? 'Enter' : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : `Sym${ch.charCodeAt(0)}`);
const keyFor = (ch) => (ch === '\n' ? 'Enter' : ch);

/**
 * Type a sequence of keys (characters or 'Backspace') into an engine.
 * @param {ReturnType<typeof createEngine>} engine Engine.
 * @param {string[]} keys Keys.
 * @param {{start?:number, seed?:number, mean?:number, jitter?:number, dwell?:number, dwellJitter?:number, isTrusted?:boolean}} [o]
 * @returns {number} Time after the last key.
 */
export function typeKeys(engine, keys, o = {}) {
  const rng = createRng(o.seed ?? 7);
  let t = o.start ?? 1000;
  const meanIv = o.mean ?? 160;
  const jitter = o.jitter ?? 0.45;
  for (const k of keys) {
    const key = k === 'Backspace' ? 'Backspace' : keyFor(k);
    const code = k === 'Backspace' ? 'Backspace' : codeFor(k);
    engine.keyDown({ key, code, t, isTrusted: o.isTrusted ?? true });
    const dwell = (o.dwell ?? 90) * (1 + (rng.next() - 0.5) * (o.dwellJitter ?? 0.5));
    engine.keyUp({ key, code, t: t + dwell });
    t += Math.max(1, meanIv * (1 + (rng.next() - 0.5) * 2 * jitter));
  }
  return t;
}

/** Split a string into key presses. */
export const keysOf = (s) => [...s];

/**
 * Run a complete engine session over a fresh text.
 * @param {{modeId?:string, options?:Object, seed?:number, policy?:'free'|'strict', keys?:(text:string)=>string[], typist?:Object}} [o]
 */
export function session(o = {}) {
  const engine = createEngine({ modeId: o.modeId || 'sentence', options: o.options, policy: o.policy });
  engine.load({ seed: o.seed ?? 42, text: o.text });
  const text = engine.getSnapshot().text;
  const keys = o.keys ? o.keys(text) : keysOf(text);
  const end = typeKeys(engine, keys, o.typist);
  return { engine, text, end };
}
