/**
 * Deterministic replay of a keystroke log through the engine. Used for: server-side
 * recomputation (anti-cheat), the 1x/2x/4x replay viewer, and the ghost-race caret.
 * Same log + same seed/options -> same metrics, always.
 * @module core/replay
 */
import { createEngine, STATES } from './engine.js';

/**
 * Turn paired entries back into a time-ordered event stream (downs before ups on ties).
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @returns {{type:'down'|'up'|'mark', t:number, e:Object, i:number}[]}
 */
export function buildReplayEvents(entries) {
  const evs = [];
  entries.forEach((e, i) => {
    if (e.kind === 'key' || e.kind === 'ime') {
      evs.push({ type: 'down', t: e.tDown, e, i });
      if (e.tUp !== null && e.tUp !== undefined && Number.isFinite(e.tUp)) evs.push({ type: 'up', t: e.tUp, e, i });
    } else {
      evs.push({ type: 'mark', t: e.tDown, e, i });
    }
  });
  const order = { down: 0, mark: 1, up: 2 };
  evs.sort((a, b) => a.t - b.t || order[a.type] - order[b.type] || a.i - b.i);
  return evs;
}

/**
 * Feed one replay event into an engine.
 * @param {ReturnType<typeof createEngine>} engine Engine.
 * @param {{type:string, t:number, e:Object}} ev Event.
 */
export function applyReplayEvent(engine, ev) {
  const { e } = ev;
  if (ev.type === 'down') {
    engine.keyDown({ key: e.key, code: e.code, t: e.tDown, isTrusted: e.isTrusted, ctrl: Boolean(e.ctrl), kind: e.kind });
  } else if (ev.type === 'up') {
    engine.keyUp({ key: e.key, code: e.code, t: e.tUp, isTrusted: e.isTrusted });
  } else {
    engine.mark(e.kind, e.tDown, { isTrusted: e.isTrusted });
  }
}

/**
 * Replay a full run and return the finished engine.
 * @param {{modeId:string, options?:Object, policy?:'free'|'strict', seed:number, text?:string, ctx?:Object, entries:Object[]}} run
 * @returns {ReturnType<typeof createEngine>}
 */
export function replayRun({ modeId, options = {}, policy = 'free', seed, text, ctx, entries }) {
  const engine = createEngine({ modeId, options, policy });
  engine.load({ seed, text, ctx });
  for (const ev of buildReplayEvents(entries)) applyReplayEvent(engine, ev);
  const snap = engine.getSnapshot();
  if (snap.status === STATES.RUNNING && snap.durationMs) engine.tick(snap.startT + snap.durationMs);
  return engine;
}

/**
 * Caret position over time (relative ms from the first keystroke). Drives the ghost caret.
 * @param {Object} run Same shape as replayRun's argument.
 * @returns {{t:number, caret:number}[]}
 */
export function caretTimeline(run) {
  const engine = createEngine({ modeId: run.modeId, options: run.options, policy: run.policy });
  engine.load({ seed: run.seed, text: run.text, ctx: run.ctx });
  const out = [];
  for (const ev of buildReplayEvents(run.entries)) {
    applyReplayEvent(engine, ev);
    if (ev.type !== 'down') continue;
    const s = engine.getSnapshot();
    if (s.startT !== null) out.push({ t: ev.t - s.startT, caret: s.caret });
  }
  return out;
}

/**
 * Ghost caret index at a relative time (binary search over the timeline).
 * @param {{t:number, caret:number}[]} timeline Timeline.
 * @param {number} relT Milliseconds since the current run started.
 * @returns {number}
 */
export function ghostCaretAt(timeline, relT) {
  let lo = 0;
  let hi = timeline.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t <= relT) {
      ans = timeline[mid].caret;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
