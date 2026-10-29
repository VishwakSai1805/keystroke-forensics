/**
 * Pure metric functions. No DOM, no clocks, no globals. Every function guards against
 * zero/negative elapsed time and empty input so NaN or Infinity can never escape.
 *
 * Definitions (one "word" = 5 characters, the typing-industry standard):
 *   Gross WPM      = (typedChars / 5) / minutes
 *   Net WPM        = max(0, (typedChars - uncorrectedErrors) / 5 / minutes)
 *   Raw accuracy   = correctKeystrokes / totalKeystrokes * 100   (counts errors later fixed)
 *   Final accuracy = (typedChars - uncorrectedErrors) / typedChars * 100   (judged on end text)
 *   Consistency    = 100 - CV(inter-key intervals, 3-sigma trimmed) in percent, clamped to [0,100]
 *   Score          = netWPM * (finalAccuracy / 100)^2
 * @module core/metrics
 */
import { charStrokes, keystrokes } from './telemetry.js';

export const CHARS_PER_WORD = 5;

/**
 * Coerce to a finite number.
 * @param {number} x Value.
 * @param {number} [fallback=0] Fallback when not finite.
 * @returns {number}
 */
export function finite(x, fallback = 0) {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, finite(x, lo)));
}

/** @param {number} x @param {number} [d=1] decimals @returns {number} */
export function round(x, d = 1) {
  const p = 10 ** d;
  return Math.round(finite(x) * p) / p;
}

/** Arithmetic mean (0 for empty). @param {number[]} a @returns {number} */
export function mean(a) {
  if (!a.length) return 0;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

/** Population standard deviation (0 for < 2 values). @param {number[]} a @returns {number} */
export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return Math.sqrt(s / a.length);
}

/** Median (0 for empty). @param {number[]} a @returns {number} */
export function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Words per minute for a character count over an elapsed time.
 * @param {number} chars Characters.
 * @param {number} elapsedMs Elapsed milliseconds.
 * @returns {number} WPM, 0 when elapsed <= 0.
 */
export function wpm(chars, elapsedMs) {
  if (!(elapsedMs > 0) || !(chars > 0)) return 0;
  return finite(chars / CHARS_PER_WORD / (elapsedMs / 60000));
}

/**
 * Gross WPM = (typedChars / 5) / minutes.
 * @example grossWpm(250, 60000) // 50
 * @param {number} typedChars Characters present in the input.
 * @param {number} elapsedMs Elapsed ms.
 * @returns {number}
 */
export function grossWpm(typedChars, elapsedMs) {
  return wpm(typedChars, elapsedMs);
}

/**
 * Net WPM = ((typedChars - uncorrectedErrors) / 5) / minutes, floored at 0.
 * @example netWpm(250, 10, 60000) // 48
 * @param {number} typedChars Characters present in the input.
 * @param {number} uncorrected Uncorrected errors in the input.
 * @param {number} elapsedMs Elapsed ms.
 * @returns {number}
 */
export function netWpm(typedChars, uncorrected, elapsedMs) {
  return wpm(Math.max(0, typedChars - uncorrected), elapsedMs);
}

/**
 * Raw accuracy: correct keystrokes / all printable keystrokes, as a percentage.
 * @example rawAccuracy(95, 100) // 95
 * @param {number} correct Correct keystrokes.
 * @param {number} total Total printable keystrokes.
 * @returns {number} 0..100 (0 when no keystrokes).
 */
export function rawAccuracy(correct, total) {
  if (!(total > 0)) return 0;
  return clamp((correct / total) * 100, 0, 100);
}

/**
 * Count positions where the typed input differs from the target.
 * @param {string} typed Final input.
 * @param {string} text Target text.
 * @returns {number}
 */
export function countUncorrected(typed, text) {
  let n = 0;
  for (let i = 0; i < typed.length; i++) if (typed[i] !== text[i]) n++;
  return n;
}

/**
 * Final accuracy judged on the end text.
 * @example finalAccuracy('helo world', 'hello world') // 70
 * @param {string} typed Final input.
 * @param {string} text Target text.
 * @returns {number} 0..100 (0 for empty input).
 */
export function finalAccuracy(typed, text) {
  if (!typed.length) return 0;
  return clamp(((typed.length - countUncorrected(typed, text)) / typed.length) * 100, 0, 100);
}

/**
 * Leaderboard score = netWPM * (finalAccuracy / 100)^2. Punishes sloppy speed quadratically.
 * @example leaderboardScore(80, 95) // 72.2
 * @param {number} net Net WPM.
 * @param {number} acc Final accuracy %.
 * @returns {number}
 */
export function leaderboardScore(net, acc) {
  return round(Math.max(0, finite(net)) * (clamp(acc, 0, 100) / 100) ** 2, 2);
}

/**
 * Inter-key intervals (ms) between successive keystrokes that changed the text.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @returns {number[]}
 */
export function interKeyIntervals(entries) {
  const ks = keystrokes(entries);
  const out = [];
  for (let i = 1; i < ks.length; i++) {
    const d = ks[i].tDown - ks[i - 1].tDown;
    if (d >= 0 && Number.isFinite(d)) out.push(d);
  }
  return out;
}

/**
 * Remove values more than `sigma` standard deviations from the mean (single pass).
 * @param {number[]} values Values.
 * @param {number} [sigma=3] Threshold.
 * @returns {number[]}
 */
export function trimOutliers(values, sigma = 3) {
  if (values.length < 3) return values.slice();
  const m = mean(values);
  const sd = stdev(values);
  if (sd === 0) return values.slice();
  return values.filter((v) => Math.abs(v - m) <= sigma * sd);
}

/**
 * Coefficient of variation in percent.
 * @param {number[]} values Values.
 * @returns {number}
 */
export function coefficientOfVariation(values) {
  const m = mean(values);
  if (!(m > 0)) return 0;
  return (stdev(values) / m) * 100;
}

/**
 * Consistency = 100 - CV of inter-key intervals (outliers trimmed at 3 sigma), clamped to [0,100].
 * @example consistency([100, 100, 100]) // 100
 * @param {number[]} intervals Intervals in ms.
 * @returns {number}
 */
export function consistency(intervals) {
  if (intervals.length < 2) return 0;
  return clamp(100 - coefficientOfVariation(trimOutliers(intervals, 3)), 0, 100);
}

/**
 * Burst WPM: the best rolling window (default 5 s) of correct characters.
 * Runs shorter than the window use their own duration (min 1 s) as the window.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @param {number} elapsedMs Run duration.
 * @param {number} [windowMs=5000] Window length.
 * @returns {number}
 */
export function burstWpm(entries, elapsedMs, windowMs = 5000) {
  const t = charStrokes(entries)
    .filter((e) => e.correct)
    .map((e) => e.tDown);
  if (!t.length || !(elapsedMs > 0)) return 0;
  const w = Math.max(1000, Math.min(windowMs, elapsedMs));
  let best = 0;
  let i = 0;
  for (let j = 0; j < t.length; j++) {
    while (t[j] - t[i] > w) i++;
    best = Math.max(best, j - i + 1);
  }
  return wpm(best, w);
}

/**
 * WPM time series sampled every `stepMs` (default 500 ms).
 * `wpm` is a rolling window (default 2 s) of correct characters; `cum` is cumulative net speed.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @param {number|null} startT Run start.
 * @param {number|null} endT Run end.
 * @param {number} [stepMs=500] Sampling step.
 * @param {number} [windowMs=2000] Rolling window.
 * @returns {{t:number,wpm:number,cum:number,errors:number}[]}
 */
export function wpmSeries(entries, startT, endT, stepMs = 500, windowMs = 2000) {
  if (startT === null || endT === null || !(endT > startT)) return [];
  const cs = charStrokes(entries);
  const out = [];
  const elapsed = endT - startT;
  const times = [];
  for (let t = stepMs; t < elapsed; t += stepMs) times.push(t);
  times.push(elapsed);
  let a = 0;
  let b = 0;
  let cumCorrect = 0;
  let errIdx = 0;
  for (const rel of times) {
    const abs = startT + rel;
    while (b < cs.length && cs[b].tDown <= abs) {
      if (cs[b].correct) cumCorrect++;
      b++;
    }
    while (a < b && cs[a].tDown < abs - windowMs) a++;
    let inWin = 0;
    for (let k = a; k < b; k++) if (cs[k].correct) inWin++;
    let errors = 0;
    while (errIdx < b) {
      if (!cs[errIdx].correct) errors++;
      errIdx++;
    }
    out.push({ t: rel, wpm: round(wpm(inWin, Math.min(windowMs, rel))), cum: round(wpm(cumCorrect, rel)), errors });
  }
  return out;
}

/**
 * Least-squares slope of y over x.
 * @param {{x:number,y:number}[]} pts Points.
 * @returns {number}
 */
export function linearSlope(pts) {
  if (pts.length < 2) return 0;
  const mx = mean(pts.map((p) => p.x));
  const my = mean(pts.map((p) => p.y));
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den > 0 ? finite(num / den) : 0;
}

/**
 * Fatigue curve: WPM slope per minute across the run and first-half vs second-half speed.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @param {number|null} startT Start.
 * @param {number|null} endT End.
 * @param {{t:number,wpm:number}[]} [series] Precomputed series.
 * @returns {{slopePerMin:number, firstHalf:number, secondHalf:number, changePct:number}}
 */
export function fatigue(entries, startT, endT, series) {
  const empty = { slopePerMin: 0, firstHalf: 0, secondHalf: 0, changePct: 0 };
  if (startT === null || endT === null || !(endT > startT)) return empty;
  const s = series || wpmSeries(entries, startT, endT);
  const slopePerMin = round(linearSlope(s.map((p) => ({ x: p.t / 60000, y: p.wpm }))));
  const mid = startT + (endT - startT) / 2;
  const half = (endT - startT) / 2;
  let c1 = 0;
  let c2 = 0;
  for (const e of charStrokes(entries)) {
    if (!e.correct) continue;
    if (e.tDown <= mid) c1++;
    else c2++;
  }
  const firstHalf = round(wpm(c1, half));
  const secondHalf = round(wpm(c2, half));
  const changePct = firstHalf > 0 ? round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;
  return { slopePerMin, firstHalf, secondHalf, changePct };
}

/**
 * Flow-state detector: sliding windows with low interval variance and high accuracy,
 * merged into contiguous segments.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @param {number|null} startT Start.
 * @param {number|null} endT End.
 * @param {{windowMs?:number, stepMs?:number, maxCv?:number, minAccuracy?:number, minKeys?:number}} [opts]
 * @returns {{segments:{start:number,end:number}[], flowMs:number, flowPct:number}}
 */
export function flowState(entries, startT, endT, opts = {}) {
  const { windowMs = 3000, stepMs = 500, maxCv = 35, minAccuracy = 97, minKeys = 6 } = opts;
  const none = { segments: [], flowMs: 0, flowPct: 0 };
  if (startT === null || endT === null || !(endT > startT)) return none;
  const cs = charStrokes(entries);
  const segments = [];
  for (let w0 = startT; w0 + windowMs <= endT + stepMs; w0 += stepMs) {
    const w1 = w0 + windowMs;
    const inWin = cs.filter((e) => e.tDown >= w0 && e.tDown < w1);
    if (inWin.length < minKeys) continue;
    const iv = [];
    for (let k = 1; k < inWin.length; k++) iv.push(inWin[k].tDown - inWin[k - 1].tDown);
    const acc = (inWin.filter((e) => e.correct).length / inWin.length) * 100;
    if (coefficientOfVariation(iv) <= maxCv && acc >= minAccuracy) {
      const s = w0 - startT;
      const e = Math.min(w1, endT) - startT;
      const last = segments[segments.length - 1];
      if (last && s <= last.end) last.end = Math.max(last.end, e);
      else segments.push({ start: s, end: e });
    }
  }
  const flowMs = segments.reduce((a, s) => a + (s.end - s.start), 0);
  return { segments, flowMs, flowPct: round((flowMs / (endT - startT)) * 100) };
}

/**
 * @typedef {Object} CoreMetrics
 * @property {number} elapsedMs
 * @property {number} typedChars
 * @property {number} uncorrectedErrors
 * @property {number} correctKeystrokes
 * @property {number} totalKeystrokes
 * @property {number} backspaces
 * @property {number} grossWpm
 * @property {number} netWpm
 * @property {number} rawAccuracy
 * @property {number} finalAccuracy
 * @property {number} consistency
 * @property {number} burstWpm
 * @property {number} score
 */

/**
 * Compute the headline metrics for a run from its final input and keystroke log.
 * Identical input always yields identical output (used by client and server).
 * @param {{text:string, typed:string, entries:import('./telemetry.js').TelemetryEntry[], startT:number|null, endT:number|null, autoChars?:number}} run
 * @returns {CoreMetrics}
 */
export function computeCoreMetrics({ text, typed, entries, startT, endT, autoChars = 0 }) {
  const elapsedMs = startT !== null && endT !== null ? Math.max(0, endT - startT) : 0;
  const uncorrectedErrors = countUncorrected(typed, text);
  const typedChars = Math.max(0, typed.length - autoChars);
  const cs = charStrokes(entries);
  const correctKeystrokes = cs.filter((e) => e.correct).length;
  const totalKeystrokes = cs.length;
  const backspaces = entries.filter((e) => e.op === 'back').length;
  const net = netWpm(typedChars, uncorrectedErrors, elapsedMs);
  const facc = finalAccuracy(typed, text);
  return {
    elapsedMs: round(elapsedMs, 0),
    typedChars,
    uncorrectedErrors,
    correctKeystrokes,
    totalKeystrokes,
    backspaces,
    grossWpm: round(grossWpm(typedChars, elapsedMs)),
    netWpm: round(net),
    rawAccuracy: round(rawAccuracy(correctKeystrokes, totalKeystrokes)),
    finalAccuracy: round(facc),
    consistency: round(consistency(interKeyIntervals(entries))),
    burstWpm: round(burstWpm(entries, elapsedMs)),
    score: leaderboardScore(round(net), round(facc)),
  };
}
