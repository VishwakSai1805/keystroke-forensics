/**
 * Keystroke-dynamics biometrics (research demo). Extracts dwell times (keydown -> keyup)
 * and flight times (keyup -> next keydown), builds statistical profiles (never storing
 * text), scores live typing with scaled Manhattan or diagonal Mahalanobis distance, and
 * evaluates FAR / FRR / EER / ROC.
 * @module core/dynamics
 */
import { mean, stdev, round, clamp } from './metrics.js';
import { createRng } from './prng.js';

export const DWELL_KEYS = Object.freeze('etaoinshrdlucmpgwyfb'.split(''));
export const DIGRAPHS = Object.freeze(['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'st', 'es', 'ou', 'to', 'ed', 'ha', 'ng', 'it', 'is', 'or']);
export const FEATURE_NAMES = Object.freeze([...DWELL_KEYS.map((k) => `dwell:${k}`), ...DIGRAPHS.map((d) => `flight:${d}`), 'dwell:mean', 'dwell:sd', 'flight:mean', 'flight:sd']);
export const MIN_ENROLL_RUNS = 5;

/**
 * Raw dwell and flight samples from a log.
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @returns {{dwell:{key:string,ms:number}[], flight:{digraph:string,ms:number}[]}}
 */
export function extractTimings(entries) {
  const chars = entries.filter((e) => e.op === 'char' && e.kind === 'key' && typeof e.key === 'string' && e.key.length === 1);
  const dwell = [];
  const flight = [];
  for (let i = 0; i < chars.length; i++) {
    const e = chars[i];
    const key = e.key.toLowerCase();
    if (e.tUp !== null && e.tUp !== undefined) {
      const d = e.tUp - e.tDown;
      if (d > 0 && d < 1000) dwell.push({ key, ms: d });
    }
    if (i > 0) {
      const p = chars[i - 1];
      if (p.tUp !== null && p.tUp !== undefined && e.pos === p.pos + 1) {
        const f = e.tDown - p.tUp;
        if (f > -500 && f < 1500) flight.push({ digraph: p.key.toLowerCase() + key, ms: f });
      }
    }
  }
  return { dwell, flight };
}

/**
 * Fixed-length feature vector (NaN where a feature was not observed).
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @returns {{vector:number[], samples:number}}
 */
export function featureVector(entries) {
  const { dwell, flight } = extractTimings(entries);
  const byKey = (k) => dwell.filter((d) => d.key === k).map((d) => d.ms);
  const byDg = (g) => flight.filter((f) => f.digraph === g).map((f) => f.ms);
  const v = [];
  for (const k of DWELL_KEYS) {
    const xs = byKey(k);
    v.push(xs.length ? mean(xs) : NaN);
  }
  for (const g of DIGRAPHS) {
    const xs = byDg(g);
    v.push(xs.length ? mean(xs) : NaN);
  }
  const dAll = dwell.map((d) => d.ms);
  const fAll = flight.map((f) => f.ms);
  v.push(dAll.length ? mean(dAll) : NaN, dAll.length > 1 ? stdev(dAll) : NaN, fAll.length ? mean(fAll) : NaN, fAll.length > 1 ? stdev(fAll) : NaN);
  return { vector: v, samples: dwell.length };
}

const finiteVals = (xs) => xs.filter((x) => Number.isFinite(x));

/** Per-dimension mean and floored sd over vectors (ignoring NaN). */
function stats(vectors) {
  const dims = FEATURE_NAMES.length;
  const mu = [];
  const sd = [];
  for (let j = 0; j < dims; j++) {
    const xs = finiteVals(vectors.map((v) => v[j]));
    const m = xs.length ? mean(xs) : NaN;
    mu.push(m);
    sd.push(Number.isFinite(m) ? Math.max(xs.length > 1 ? stdev(xs) : 0, Math.abs(m) * 0.1, 5) : NaN);
  }
  return { mu, sd };
}

/**
 * Distance of a vector from a profile. Uses only dimensions observed in both.
 * @param {{mu:number[], sd:number[]}} profile Profile.
 * @param {number[]} vector Feature vector.
 * @param {'manhattan'|'mahalanobis'} [method='manhattan'] Scaled Manhattan or diagonal Mahalanobis.
 * @returns {number} Distance, or NaN if fewer than 5 shared dimensions.
 */
export function distance(profile, vector, method = 'manhattan') {
  let sum = 0;
  let n = 0;
  for (let j = 0; j < vector.length; j++) {
    const x = vector[j];
    const m = profile.mu[j];
    const s = profile.sd[j];
    if (!Number.isFinite(x) || !Number.isFinite(m) || !(s > 0)) continue;
    const z = (x - m) / s;
    sum += method === 'mahalanobis' ? z * z : Math.abs(z);
    n++;
  }
  if (n < 5) return NaN;
  return method === 'mahalanobis' ? Math.sqrt(sum / n) : sum / n;
}

/**
 * Enroll a profile from at least MIN_ENROLL_RUNS feature vectors. Stores only statistics.
 * The acceptance threshold is calibrated from leave-one-out genuine distances.
 * @param {number[][]} vectors Feature vectors (one per run).
 * @param {'manhattan'|'mahalanobis'} [method='manhattan'] Distance.
 * @returns {{version:1, method:string, n:number, mu:number[], sd:number[], threshold:number, genuine:number[], names:readonly string[]}}
 */
export function enrollProfile(vectors, method = 'manhattan') {
  if (vectors.length < MIN_ENROLL_RUNS) throw new Error(`Need at least ${MIN_ENROLL_RUNS} runs to enroll (got ${vectors.length}).`);
  const { mu, sd } = stats(vectors);
  const genuine = [];
  for (let i = 0; i < vectors.length; i++) {
    const others = vectors.filter((_, k) => k !== i);
    const d = distance(stats(others), vectors[i], method);
    if (Number.isFinite(d)) genuine.push(d);
  }
  const threshold = genuine.length ? mean(genuine) + 2 * Math.max(stdev(genuine), 0.1) : 1.5;
  return { version: 1, method, n: vectors.length, mu, sd, threshold: round(threshold, 3), genuine: genuine.map((g) => round(g, 3)), names: FEATURE_NAMES };
}

/**
 * Identity confidence in [0,1]: a logistic curve centred on the calibrated threshold.
 * @param {ReturnType<typeof enrollProfile>} profile Profile.
 * @param {number[]} vector Feature vector.
 * @returns {{confidence:number, distance:number}|null} null when too few features overlap.
 */
export function identityConfidence(profile, vector) {
  const d = distance(profile, vector, profile.method);
  if (!Number.isFinite(d)) return null;
  const k = Math.max(profile.threshold * 0.2, 0.05);
  return { confidence: round(clamp(1 / (1 + Math.exp((d - profile.threshold) / k)), 0, 1), 3), distance: round(d, 3) };
}

/**
 * Feature vector from the most recent N character entries (live continuous auth).
 * @param {import('./telemetry.js').TelemetryEntry[]} entries Entries.
 * @param {number} [lastN=80] Window size.
 */
export function liveVector(entries, lastN = 80) {
  const chars = entries.filter((e) => e.op === 'char');
  return featureVector(chars.slice(-lastN));
}

/**
 * Synthetic impostor vectors: per-feature rescaling of genuine vectors (a documented
 * baseline when no real impostor sessions exist; see BIOMETRICS.md).
 * @param {number[][]} vectors Genuine vectors.
 * @param {number} seed Seed.
 * @param {number} [count=10] Count.
 * @returns {number[][]}
 */
export function syntheticImpostors(vectors, seed, count = 10) {
  const rng = createRng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = vectors[rng.int(vectors.length)];
    const dwellScale = 0.65 + rng.next() * 0.8;
    const flightScale = 0.55 + rng.next() * 1.0;
    out.push(
      base.map((x, j) => {
        if (!Number.isFinite(x)) return x;
        const isFlight = FEATURE_NAMES[j].startsWith('flight');
        const jitter = 0.85 + rng.next() * 0.3;
        return x * (isFlight ? flightScale : dwellScale) * jitter;
      }),
    );
  }
  return out;
}

/**
 * Evaluate a verifier: ROC curve, FAR/FRR at each threshold, equal error rate and AUC.
 * Lower distance = more likely genuine; accept when distance <= threshold.
 * @param {number[]} genuine Genuine distances.
 * @param {number[]} impostor Impostor distances.
 * @returns {{roc:{threshold:number, far:number, frr:number, tpr:number}[], eer:number, eerThreshold:number, auc:number}}
 */
export function evaluateVerifier(genuine, impostor) {
  const g = finiteVals(genuine);
  const im = finiteVals(impostor);
  if (!g.length || !im.length) return { roc: [], eer: NaN, eerThreshold: NaN, auc: NaN };
  const thresholds = [...new Set([0, ...g, ...im, Math.max(...g, ...im) + 1])].sort((a, b) => a - b);
  const roc = thresholds.map((t) => {
    const far = im.filter((d) => d <= t).length / im.length;
    const frr = g.filter((d) => d > t).length / g.length;
    return { threshold: round(t, 3), far: round(far, 4), frr: round(frr, 4), tpr: round(1 - frr, 4) };
  });
  let best = roc[0];
  for (const p of roc) if (Math.abs(p.far - p.frr) < Math.abs(best.far - best.frr)) best = p;
  let auc = 0;
  for (let i = 1; i < roc.length; i++) auc += (roc[i].far - roc[i - 1].far) * ((roc[i].tpr + roc[i - 1].tpr) / 2);
  return { roc, eer: round(((best.far + best.frr) / 2) * 100, 2), eerThreshold: best.threshold, auc: round(auc, 4) };
}
