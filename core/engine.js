/**
 * Typing engine: a finite state machine IDLE -> ARMED -> RUNNING -> COMPLETE (or FAILED).
 * Framework-agnostic and DOM-free. Exposes an external-store API (subscribe/getSnapshot)
 * so React can bind through useSyncExternalStore and vanilla JS through a plain listener.
 *
 * The original 7-step lab algorithm is implemented as seven named, exported functions:
 *   STEP 1 displayRandomSentence      STEP 5 calculateTime
 *   STEP 2 startTimerOnFirstKeystroke STEP 6 computeWpmAndAccuracy
 *   STEP 3 captureInput               STEP 7 displayResults
 *   STEP 4 compareWithOriginal
 * @module core/engine
 */
import { createTelemetry } from './telemetry.js';
import { getMode, resolveOptions } from './modes/index.js';
import { computeCoreMetrics, round, netWpm, grossWpm, rawAccuracy, clamp } from './metrics.js';
import { randomSeed } from './prng.js';

export const STATES = Object.freeze({
  IDLE: 'IDLE',
  ARMED: 'ARMED',
  RUNNING: 'RUNNING',
  COMPLETE: 'COMPLETE',
  FAILED: 'FAILED',
});

/** Explicit transition table. Anything not listed is illegal and throws. */
export const TRANSITIONS = Object.freeze({
  IDLE: Object.freeze(['ARMED']),
  ARMED: Object.freeze(['ARMED', 'RUNNING', 'IDLE']),
  RUNNING: Object.freeze(['COMPLETE', 'FAILED', 'ARMED', 'IDLE']),
  COMPLETE: Object.freeze(['ARMED', 'IDLE']),
  FAILED: Object.freeze(['ARMED', 'IDLE']),
});

/**
 * Whether a transition is legal.
 * @param {string} from From state.
 * @param {string} to To state.
 * @returns {boolean}
 */
export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

/**
 * Perform a transition or throw.
 * @param {EngineState} s Engine state.
 * @param {string} to Target state.
 */
export function transition(s, to) {
  if (!canTransition(s.status, to)) throw new Error(`Illegal transition ${s.status} -> ${to}`);
  s.status = to;
}

/**
 * @typedef {Object} EngineState
 * @property {string} status
 * @property {string} modeId
 * @property {import('./modes/_shared.js').Mode} mode
 * @property {Object} options
 * @property {'free'|'strict'} policy
 * @property {number} seed
 * @property {number} chunk
 * @property {string} text
 * @property {Object} meta
 * @property {string[]} typed
 * @property {Set<number>} auto Positions auto-inserted by indentation handling.
 * @property {number} mismatches
 * @property {number|null} startT
 * @property {number|null} endT
 * @property {{total:number, correct:number, backspaces:number}} counts
 * @property {ReturnType<typeof createTelemetry>} telemetry
 * @property {Object|null} result
 * @property {string|null} failReason
 * @property {{from:number,to:number}|null} lastChange
 * @property {number} version
 */

/**
 * Create a fresh engine state.
 * @param {{modeId?:string, options?:Object, policy?:'free'|'strict'}} [config]
 * @returns {EngineState}
 */
export function createState(config = {}) {
  const modeId = config.modeId || 'sentence';
  return {
    status: STATES.IDLE,
    modeId,
    mode: getMode(modeId),
    options: resolveOptions(modeId, config.options),
    policy: config.policy === 'strict' ? 'strict' : 'free',
    seed: 0,
    chunk: 0,
    text: '',
    meta: {},
    typed: [],
    auto: new Set(),
    mismatches: 0,
    startT: null,
    endT: null,
    counts: { total: 0, correct: 0, backspaces: 0 },
    telemetry: createTelemetry(),
    result: null,
    failReason: null,
    lastChange: null,
    version: 0,
  };
}

/**
 * STEP 1 - Display a random sentence: generate the target text from the mode's seeded
 * provider (or accept an explicit text) and arm the engine.
 * @param {EngineState} s State.
 * @param {{seed?:number, text?:string, ctx?:Object}} [opts]
 * @returns {string} The target text.
 */
export function displayRandomSentence(s, opts = {}) {
  s.seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : randomSeed();
  const gen = typeof opts.text === 'string' && opts.text.length ? { text: opts.text, meta: {} } : s.mode.generate(s.seed, s.options, opts.ctx || {});
  s.text = gen.text;
  s.meta = gen.meta || {};
  s.chunk = 0;
  s.typed = [];
  s.auto = new Set();
  s.mismatches = 0;
  s.startT = null;
  s.endT = null;
  s.counts = { total: 0, correct: 0, backspaces: 0 };
  s.telemetry = createTelemetry();
  s.result = null;
  s.failReason = null;
  s.lastChange = { from: 0, to: s.text.length };
  transition(s, STATES.ARMED);
  maybeExtend(s);
  return s.text;
}

/**
 * STEP 2 - Start the timer on the first keystroke (ARMED -> RUNNING).
 * @param {EngineState} s State.
 * @param {number} t performance.now() of the keystroke.
 * @returns {boolean} True if the timer started.
 */
export function startTimerOnFirstKeystroke(s, t) {
  if (s.status !== STATES.ARMED) return false;
  s.startT = t;
  transition(s, STATES.RUNNING);
  return true;
}

/**
 * STEP 3 - Capture input continuously: apply a character, a rejected character (strict
 * policy) or a backspace to the input buffer.
 * @param {EngineState} s State.
 * @param {{type:'char', ch:string}|{type:'back', word:boolean}} action Normalized action.
 * @returns {{op:'char'|'reject'|'back', pos:number|null, expected:string|null, correct:boolean|null, prevLength?:number}}
 */
export function captureInput(s, action) {
  if (action.type === 'back') {
    const prevLength = s.typed.length;
    s.counts.backspaces++;
    if (prevLength === 0) return { op: 'back', pos: null, expected: null, correct: null, prevLength };
    let i = prevLength;
    if (action.word) {
      while (i > 0 && /\s/.test(s.typed[i - 1])) i--;
      while (i > 0 && !/\s/.test(s.typed[i - 1])) i--;
    } else i--;
    while (s.typed.length > i) {
      const p = s.typed.length - 1;
      if (s.typed[p] !== s.text[p]) s.mismatches--;
      s.auto.delete(p);
      s.typed.pop();
    }
    return { op: 'back', pos: s.typed.length, expected: null, correct: null, prevLength };
  }
  const pos = s.typed.length;
  const expected = pos < s.text.length ? s.text[pos] : null;
  s.counts.total++;
  if ((s.policy === 'strict' && s.mismatches > 0) || expected === null) {
    return { op: 'reject', pos, expected, correct: false };
  }
  s.typed.push(action.ch);
  const correct = compareWithOriginal(s, pos, action.ch);
  if (correct) s.counts.correct++;
  else s.mismatches++;
  if (correct && action.ch === '\n' && s.mode.autoIndent) {
    while (s.typed.length < s.text.length && s.text[s.typed.length] === ' ') {
      s.auto.add(s.typed.length);
      s.typed.push(' ');
    }
  }
  return { op: 'char', pos, expected, correct };
}

/**
 * STEP 4 - Compare the typed character with the original at the same position.
 * @param {EngineState} s State.
 * @param {number} pos Index.
 * @param {string} ch Typed character.
 * @returns {boolean}
 */
export function compareWithOriginal(s, pos, ch) {
  return s.text[pos] === ch;
}

/**
 * STEP 5 - Calculate time: fix the end timestamp and return elapsed milliseconds.
 * @param {EngineState} s State.
 * @param {number} tEnd End timestamp.
 * @returns {number} Elapsed ms (>= 0).
 */
export function calculateTime(s, tEnd) {
  s.endT = tEnd;
  return s.startT === null ? 0 : Math.max(0, tEnd - s.startT);
}

/**
 * STEP 6 - Compute WPM and accuracy (and every other headline metric) from the final
 * input and the keystroke log. Pure given the state.
 * @param {EngineState} s State.
 * @returns {Object} Result.
 */
export function computeWpmAndAccuracy(s) {
  const typed = s.typed.join('');
  const entries = s.telemetry.entries();
  const core = computeCoreMetrics({ text: s.text, typed, entries, startT: s.startT, endT: s.endT, autoChars: s.auto.size });
  const extras = s.mode.extras ? s.mode.extras({ text: s.text, typed, elapsedMs: core.elapsedMs }) : {};
  s.result = {
    ...core,
    extras,
    modeId: s.modeId,
    options: s.options,
    policy: s.policy,
    seed: s.seed,
    boardKey: s.mode.scoreRules.boardKey(s.options),
    ranked: s.mode.scoreRules.ranked,
    text: s.mode.extend ? s.text.slice(0, Math.max(typed.length, 1)) : s.text,
    typed,
    meta: s.meta,
    failed: s.status === STATES.FAILED || s.failReason !== null,
    failReason: s.failReason,
  };
  return s.result;
}

/**
 * STEP 7 - Display results: publish the completed result to every subscriber. The UI layer
 * (vanilla or React) renders it; aria-live announces it once.
 * @param {EngineState} s State.
 * @param {(event:Object)=>void} emit Publisher.
 * @returns {Object} The result that was published.
 */
export function displayResults(s, emit) {
  emit({ type: s.status === STATES.FAILED ? 'failed' : 'complete', result: s.result });
  return s.result;
}

/** Append streamed text for timed modes so the caret never reaches the end. */
function maybeExtend(s) {
  if (!s.mode.extend) return;
  while (s.text.length - s.typed.length < 80) {
    s.chunk += 1;
    s.text += s.mode.extend(s.seed, s.chunk, s.options);
  }
}

/**
 * Map a key to an engine action.
 * @param {string} key KeyboardEvent.key.
 * @param {boolean} ctrl Word-delete modifier.
 * @param {string} text Target text (Enter only counts when the text contains newlines).
 * @returns {{type:'char',ch:string}|{type:'back',word:boolean}|null}
 */
export function normalizeAction(key, ctrl, text) {
  if (key === 'Backspace') return { type: 'back', word: Boolean(ctrl) };
  if (key === 'Enter') return text.includes('\n') ? { type: 'char', ch: '\n' } : null;
  if (typeof key === 'string' && key.length === 1 && key >= ' ') return { type: 'char', ch: key };
  return null;
}

const durationOf = (s) => (s.mode.durationMs ? s.mode.durationMs(s.options) : null);

/**
 * Immutable snapshot for subscribers. `typed` is the live buffer; treat it as read-only.
 * @param {EngineState} s State.
 */
function makeSnapshot(s) {
  return Object.freeze({
    version: s.version,
    status: s.status,
    modeId: s.modeId,
    options: s.options,
    policy: s.policy,
    seed: s.seed,
    text: s.text,
    meta: s.meta,
    typed: s.typed,
    caret: s.typed.length,
    mismatches: s.mismatches,
    startT: s.startT,
    endT: s.endT,
    durationMs: durationOf(s),
    lastChange: s.lastChange,
    counts: { ...s.counts },
    result: s.result,
    failReason: s.failReason,
    ui: s.mode.ui,
  });
}

/**
 * @typedef {Object} KeyInput
 * @property {string} key KeyboardEvent.key (or a composed character).
 * @property {string} [code] KeyboardEvent.code.
 * @property {number} t performance.now() timestamp.
 * @property {boolean} [isTrusted=true]
 * @property {boolean} [repeat=false]
 * @property {boolean} [ctrl=false]
 * @property {'key'|'ime'} [kind='key']
 */

/**
 * Create an engine instance.
 * @param {{modeId?:string, options?:Object, policy?:'free'|'strict'}} [config]
 */
export function createEngine(config = {}) {
  let s = createState(config);
  const listeners = new Set();
  let snapshot = makeSnapshot(s);

  const emit = (event) => {
    s.version += 1;
    snapshot = makeSnapshot(s);
    for (const fn of listeners) fn(event);
  };

  const finish = (tEnd) => {
    calculateTime(s, tEnd);
    transition(s, STATES.COMPLETE);
    computeWpmAndAccuracy(s);
    displayResults(s, emit);
  };

  const fail = (t, reason) => {
    calculateTime(s, t);
    s.failReason = reason;
    transition(s, STATES.FAILED);
    computeWpmAndAccuracy(s);
    displayResults(s, emit);
  };

  return {
    /** Reconfigure mode/options/policy. Returns to IDLE; call load() next. */
    configure(next = {}) {
      s = createState({ modeId: next.modeId || s.modeId, options: next.options ?? s.options, policy: next.policy || s.policy });
      emit({ type: 'configure' });
    },
    /** Load a new target text (STEP 1). */
    load(opts = {}) {
      if (s.status !== STATES.IDLE && !canTransition(s.status, STATES.ARMED)) transition(s, STATES.IDLE);
      displayRandomSentence(s, opts);
      emit({ type: 'load' });
      return s.text;
    },
    /**
     * Process a keydown. Returns true when the input changed state.
     * @param {KeyInput} ev
     */
    keyDown(ev) {
      const { key, code = '', t, isTrusted = true, repeat = false, ctrl = false, kind = 'key' } = ev;
      if (s.status !== STATES.ARMED && s.status !== STATES.RUNNING) return false;
      if (!Number.isFinite(t)) return false;
      const action = normalizeAction(key, ctrl, s.text);
      if (!action) return false;
      if (repeat && action.type === 'char') return false;
      if (s.status === STATES.ARMED) {
        if (action.type === 'back') return false;
        startTimerOnFirstKeystroke(s, t);
      }
      const dur = durationOf(s);
      if (dur && t - s.startT >= dur) {
        finish(s.startT + dur);
        return false;
      }
      const prev = s.typed.length;
      const r = captureInput(s, action);
      s.telemetry.down({
        kind,
        key,
        code,
        op: r.op,
        pos: r.pos,
        expected: r.expected,
        correct: r.correct,
        t,
        isTrusted: Boolean(isTrusted),
        ...(ctrl ? { ctrl: true } : {}),
      });
      s.lastChange = { from: Math.min(prev, s.typed.length), to: Math.max(prev, s.typed.length) + 1 };
      maybeExtend(s);
      if (r.op !== 'back' && r.correct === false && s.mode.failOnError) {
        fail(t, 'mistake');
      } else if (s.mode.isComplete({ typedLength: s.typed.length, textLength: s.text.length, startT: s.startT, mismatches: s.mismatches }, t, s.options)) {
        finish(t);
      } else {
        emit({ type: 'key', op: r.op });
      }
      return true;
    },
    /** Record a keyup (pairs with its keydown for dwell time). Never changes the text. */
    keyUp(ev) {
      if (s.status === STATES.IDLE) return false;
      return s.telemetry.up({ code: ev.code || '', key: ev.key, t: ev.t, isTrusted: ev.isTrusted !== false });
    },
    /** Record a non-keystroke event (paste attempt, blur, IME composition). */
    mark(kind, t, data) {
      if (s.status === STATES.IDLE) return;
      s.telemetry.mark(kind, t, data);
    },
    /** Advance time; completes timed runs at exactly startT + duration. */
    tick(now) {
      const dur = durationOf(s);
      if (s.status === STATES.RUNNING && dur && now - s.startT >= dur) {
        finish(s.startT + dur);
        return true;
      }
      return false;
    },
    /** Abandon the current run and re-arm with the same text. */
    restart() {
      if (s.status === STATES.IDLE) return;
      const meta = s.meta;
      displayRandomSentence(s, { seed: s.seed, text: s.mode.extend ? undefined : s.text });
      if (!s.mode.extend) s.meta = meta;
      emit({ type: 'load' });
    },
    /**
     * Cheap live metrics for the HUD (O(1)); final numbers come from STEP 6.
     * @param {number} now performance.now().
     */
    live(now) {
      const dur = durationOf(s);
      let elapsed = s.startT === null ? 0 : (s.endT ?? now) - s.startT;
      if (dur) elapsed = Math.min(elapsed, dur);
      elapsed = Math.max(0, elapsed);
      const chars = Math.max(0, s.typed.length - s.auto.size);
      return {
        elapsedMs: elapsed,
        remainingMs: dur ? Math.max(0, dur - elapsed) : null,
        netWpm: round(netWpm(chars, s.mismatches, elapsed)),
        grossWpm: round(grossWpm(chars, elapsed)),
        rawAccuracy: round(rawAccuracy(s.counts.correct, s.counts.total)),
        finalAccuracy: s.typed.length ? round(clamp(((s.typed.length - s.mismatches) / s.typed.length) * 100, 0, 100)) : 0,
        keystrokes: s.counts.total,
        errors: s.counts.total - s.counts.correct,
        progress: s.text.length && !dur ? s.typed.length / s.text.length : dur ? elapsed / dur : 0,
      };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    entries: () => s.telemetry.entries(),
    events: () => s.telemetry.events(),
    /** Internal state (tests and the analytics worker hand-off). */
    get state() {
      return s;
    },
  };
}
