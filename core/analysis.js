/**
 * Heavy post-run analytics: per-key and per-bigram latency, finger load, error timeline,
 * keyboard heat, fatigue, flow and a plain-English diagnosis. Runs inside a Web Worker in
 * the browser and directly in tests / on the server.
 * @module core/analysis
 */
import { keystrokes, charStrokes } from './telemetry.js';
import { computeCoreMetrics, wpmSeries, fatigue, flowState, mean, median, round } from './metrics.js';
import { fingerFor, getLayout, FINGERS, FINGER_NAMES } from './layouts.js';
import { COMMON_WORDS } from './corpus/words.js';

const visible = (c) => (c === ' ' ? 'space' : c === '\n' ? 'enter' : c);

/**
 * Per-character latency (time since previous keystroke) and error rate, keyed by expected char.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @returns {{char:string, count:number, errors:number, errorRate:number, meanLatency:number}[]}
 */
export function perKeyStats(entries) {
  const ks = keystrokes(entries);
  const map = new Map();
  for (let i = 0; i < ks.length; i++) {
    const e = ks[i];
    if (e.op === 'back' || e.expected === null) continue;
    const k = e.expected;
    if (!map.has(k)) map.set(k, { char: k, count: 0, errors: 0, lat: [] });
    const m = map.get(k);
    m.count++;
    if (!e.correct) m.errors++;
    if (i > 0) {
      const d = e.tDown - ks[i - 1].tDown;
      if (d > 0 && d < 3000) m.lat.push(d);
    }
  }
  return [...map.values()]
    .map((m) => ({ char: m.char, count: m.count, errors: m.errors, errorRate: round((m.errors / m.count) * 100), meanLatency: round(mean(m.lat), 0) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Per-bigram transition latency between consecutive correct characters.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @returns {{bigram:string, count:number, meanLatency:number}[]}
 */
export function bigramStats(entries) {
  const cs = charStrokes(entries);
  const map = new Map();
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1];
    const b = cs[i];
    if (a.op !== 'char' || b.op !== 'char' || !a.correct || !b.correct || b.pos !== a.pos + 1) continue;
    if (/\s/.test(a.expected) || /\s/.test(b.expected)) continue;
    const d = b.tDown - a.tDown;
    if (!(d > 0 && d < 3000)) continue;
    const bg = (a.expected + b.expected).toLowerCase();
    if (!map.has(bg)) map.set(bg, []);
    map.get(bg).push(d);
  }
  return [...map.entries()].map(([bigram, l]) => ({ bigram, count: l.length, meanLatency: round(mean(l), 0) })).sort((a, b) => b.meanLatency - a.meanLatency);
}

/**
 * The n slowest bigrams (prefers bigrams seen at least twice).
 * @param {{bigram:string,count:number,meanLatency:number}[]} bigrams Bigram stats.
 * @param {number} [n=5] Count.
 * @returns {{bigram:string,count:number,meanLatency:number,slowdownPct:number}[]}
 */
export function slowestBigrams(bigrams, n = 5) {
  const med = median(bigrams.map((b) => b.meanLatency));
  const repeated = bigrams.filter((b) => b.count >= 2);
  const pool = repeated.length >= n ? repeated : bigrams;
  return pool
    .slice()
    .sort((a, b) => b.meanLatency - a.meanLatency)
    .slice(0, n)
    .map((b) => ({ ...b, slowdownPct: med > 0 ? round(((b.meanLatency - med) / med) * 100, 0) : 0 }));
}

/**
 * Per-finger load (share of keystrokes) and error rate.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @param {string} [layout='qwerty'] Layout.
 * @returns {{finger:string, name:string, count:number, load:number, errors:number, errorRate:number}[]}
 */
export function fingerStats(entries, layout = 'qwerty') {
  const counts = Object.fromEntries(FINGERS.map((f) => [f, { count: 0, errors: 0 }]));
  const cs = charStrokes(entries);
  let total = 0;
  for (const e of cs) {
    if (e.expected === null) continue;
    const f = fingerFor(e.expected, layout);
    if (!f) continue;
    counts[f].count++;
    if (!e.correct) counts[f].errors++;
    total++;
  }
  return FINGERS.map((f) => ({
    finger: f,
    name: FINGER_NAMES[f],
    count: counts[f].count,
    load: total ? round((counts[f].count / total) * 100) : 0,
    errors: counts[f].errors,
    errorRate: counts[f].count ? round((counts[f].errors / counts[f].count) * 100) : 0,
  }));
}

/**
 * Every incorrect keystroke with its relative time.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @param {number|null} startT Start.
 * @returns {{t:number, pos:number, expected:string, got:string}[]}
 */
export function errorTimeline(entries, startT) {
  if (startT === null) return [];
  return charStrokes(entries)
    .filter((e) => !e.correct)
    .map((e) => ({ t: round(e.tDown - startT, 0), pos: e.pos, expected: visible(e.expected ?? ''), got: visible(e.key === 'Enter' ? '\n' : e.key) }));
}

/**
 * Aggregate per-key stats onto physical keys for the on-screen heatmap.
 * @param {ReturnType<typeof perKeyStats>} perKey Per-key stats.
 * @param {string} [layout='qwerty'] Layout.
 * @returns {Object<string,{count:number, errorRate:number, meanLatency:number}>} Keyed by KeyboardEvent.code.
 */
export function keyboardHeat(perKey, layout = 'qwerty') {
  const l = getLayout(layout);
  const acc = {};
  for (const k of perKey) {
    const hit = l.charMap.get(k.char);
    if (!hit) continue;
    const a = (acc[hit.code] ||= { count: 0, errors: 0, latSum: 0, latN: 0 });
    a.count += k.count;
    a.errors += k.errors;
    if (k.meanLatency > 0) {
      a.latSum += k.meanLatency * k.count;
      a.latN += k.count;
    }
  }
  const out = {};
  for (const [code, a] of Object.entries(acc)) {
    out[code] = { count: a.count, errorRate: round((a.errors / a.count) * 100), meanLatency: a.latN ? round(a.latSum / a.latN, 0) : 0 };
  }
  return out;
}

/**
 * Practice words containing a bigram (short ones first).
 * @param {string} bigram Bigram.
 * @param {number} [n=2] Count.
 * @returns {string[]}
 */
export function practiceWords(bigram, n = 2) {
  return COMMON_WORDS.filter((w) => w.includes(bigram))
    .sort((a, b) => a.length - b.length)
    .slice(0, n);
}

/**
 * One-line plain-English diagnosis.
 * @param {{metrics:Object, slowest:Object[], perKey:Object[], fatigue:Object}} a Analysis pieces.
 * @returns {string}
 */
export function diagnose({ metrics, slowest, perKey, fatigue: fat }) {
  if (!metrics || metrics.totalKeystrokes < 5) return 'Not enough keystrokes for a diagnosis yet. Type a little longer.';
  const worstKey = perKey.filter((k) => k.count >= 3 && k.errors > 0).sort((a, b) => b.errorRate - a.errorRate)[0];
  if (metrics.finalAccuracy < 94 && worstKey) {
    return `Accuracy is the bottleneck (${metrics.finalAccuracy}%). '${visible(worstKey.char)}' misses ${worstKey.errorRate}% of the time; slow down until it is clean.`;
  }
  const top = slowest[0];
  if (top && top.slowdownPct >= 15) {
    const words = practiceWords(top.bigram);
    return `You slow ~${top.slowdownPct}% on '${top.bigram}'; practice '${[top.bigram, ...words].join(', ')}'.`;
  }
  if (fat && fat.changePct <= -12) {
    return `You fade ~${Math.abs(fat.changePct)}% in the second half; build stamina with repeated 60 s runs.`;
  }
  if (metrics.consistency < 55) return `Rhythm is uneven (consistency ${metrics.consistency}%). Aim for a steady beat rather than bursts.`;
  return `Clean and steady at ${metrics.netWpm} WPM. Push pace by about 5 WPM and hold accuracy above 96%.`;
}

/**
 * Full post-run analysis.
 * @param {{text:string, typed:string, entries:Object[], startT:number|null, endT:number|null, autoChars?:number, layout?:string}} run
 * @returns {Object}
 */
export function analyzeRun(run) {
  const { entries, startT, endT, layout = 'qwerty' } = run;
  const metrics = computeCoreMetrics(run);
  const series = wpmSeries(entries, startT, endT);
  const fat = fatigue(entries, startT, endT, series);
  const flow = flowState(entries, startT, endT);
  const perKey = perKeyStats(entries);
  const bigrams = bigramStats(entries);
  const slowest = slowestBigrams(bigrams);
  const fingers = fingerStats(entries, layout);
  const errors = errorTimeline(entries, startT);
  const heat = keyboardHeat(perKey, layout);
  return {
    metrics,
    series,
    fatigue: fat,
    flow,
    perKey,
    bigrams,
    slowest,
    fingers,
    errors,
    heat,
    diagnosis: diagnose({ metrics, slowest, perKey, fatigue: fat }),
  };
}

/**
 * Derive weak-key weights from stored analyses (for the weak-key drill).
 * @param {{perKey?:Object[], bigrams?:Object[]}[]} analyses Past analyses (most recent first).
 * @returns {{chars:Object<string,number>, bigrams:Object<string,number>}}
 */
export function weaknessFromHistory(analyses) {
  const keyAgg = new Map();
  const bgAgg = new Map();
  for (const a of analyses.slice(0, 30)) {
    for (const k of a.perKey || []) {
      if (!/[a-z]/.test(k.char)) continue;
      const v = keyAgg.get(k.char) || { count: 0, errors: 0 };
      v.count += k.count;
      v.errors += k.errors;
      keyAgg.set(k.char, v);
    }
    for (const b of a.bigrams || []) {
      if (!/^[a-z]{2}$/.test(b.bigram)) continue;
      const v = bgAgg.get(b.bigram) || { n: 0, sum: 0 };
      v.n += b.count;
      v.sum += b.meanLatency * b.count;
      bgAgg.set(b.bigram, v);
    }
  }
  const chars = {};
  const rates = [...keyAgg.entries()].filter(([, v]) => v.count >= 3).map(([k, v]) => [k, v.errors / v.count]);
  const maxRate = Math.max(0, ...rates.map(([, r]) => r));
  for (const [k, r] of rates) if (maxRate > 0 && r > 0) chars[k] = round(r / maxRate, 2);
  const bigrams = {};
  const lats = [...bgAgg.entries()].filter(([, v]) => v.n >= 2).map(([k, v]) => [k, v.sum / v.n]);
  const med = median(lats.map(([, l]) => l));
  const maxLat = Math.max(0, ...lats.map(([, l]) => l));
  for (const [k, l] of lats) if (l > med && maxLat > med) bigrams[k] = round((l - med) / (maxLat - med), 2);
  return { chars, bigrams };
}
