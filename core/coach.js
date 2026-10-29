/**
 * AI coach support: builds an aggregated, identity-free payload (never raw keystrokes),
 * validates it (client and server share this), and provides a deterministic offline plan
 * used when the user has not opted in, is offline, or the endpoint fails.
 * @module core/coach
 */
import { mean, round } from './metrics.js';
import { practiceWords } from './analysis.js';

/**
 * @typedef {Object} CoachPayload
 * @property {number} runs
 * @property {number} avgWpm
 * @property {number} avgAccuracy
 * @property {number} avgConsistency
 * @property {number} fatigueChangePct
 * @property {{bigram:string, slowdownPct:number}[]} slowBigrams
 * @property {{key:string, errorRate:number}[]} weakKeys
 */

/**
 * Aggregate stored analyses into a coach payload. Contains statistics only.
 * @param {{metrics:Object, slowest:Object[], perKey:Object[], fatigue:Object}[]} analyses Recent analyses.
 * @returns {CoachPayload}
 */
export function buildCoachPayload(analyses) {
  const recent = analyses.slice(0, 20).filter((a) => a && a.metrics);
  const bg = new Map();
  const keys = new Map();
  for (const a of recent) {
    for (const s of a.slowest || []) {
      if (!/^[a-z]{2}$/.test(s.bigram)) continue;
      const v = bg.get(s.bigram) || [];
      v.push(s.slowdownPct);
      bg.set(s.bigram, v);
    }
    for (const k of a.perKey || []) {
      if (!/^[a-z]$/.test(k.char)) continue;
      const v = keys.get(k.char) || { n: 0, e: 0 };
      v.n += k.count;
      v.e += k.errors;
      keys.set(k.char, v);
    }
  }
  return {
    runs: recent.length,
    avgWpm: round(mean(recent.map((a) => a.metrics.netWpm))),
    avgAccuracy: round(mean(recent.map((a) => a.metrics.finalAccuracy))),
    avgConsistency: round(mean(recent.map((a) => a.metrics.consistency))),
    fatigueChangePct: round(mean(recent.map((a) => (a.fatigue ? a.fatigue.changePct : 0)))),
    slowBigrams: [...bg.entries()]
      .map(([bigram, v]) => ({ bigram, slowdownPct: round(mean(v), 0) }))
      .sort((a, b) => b.slowdownPct - a.slowdownPct)
      .slice(0, 6),
    weakKeys: [...keys.entries()]
      .filter(([, v]) => v.n >= 5)
      .map(([key, v]) => ({ key, errorRate: round((v.e / v.n) * 100) }))
      .filter((k) => k.errorRate > 0)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 6),
  };
}

const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

/**
 * Strict schema check. Rejects anything that is not exactly an aggregated payload, so a
 * tampered client cannot smuggle free text or identity into the prompt.
 * @param {unknown} p Candidate.
 * @returns {{ok:true, value:CoachPayload}|{ok:false, error:string}}
 */
export function validateCoachPayload(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: 'not an object' };
  const allowed = ['runs', 'avgWpm', 'avgAccuracy', 'avgConsistency', 'fatigueChangePct', 'slowBigrams', 'weakKeys'];
  for (const k of Object.keys(p)) if (!allowed.includes(k)) return { ok: false, error: `unexpected field ${k}` };
  if (!num(p.runs, 1, 1000) || !num(p.avgWpm, 0, 400) || !num(p.avgAccuracy, 0, 100) || !num(p.avgConsistency, 0, 100) || !num(p.fatigueChangePct, -100, 1000)) {
    return { ok: false, error: 'numeric field out of range' };
  }
  if (!Array.isArray(p.slowBigrams) || p.slowBigrams.length > 10) return { ok: false, error: 'slowBigrams' };
  for (const b of p.slowBigrams) {
    if (!b || typeof b.bigram !== 'string' || !/^[a-z]{2}$/.test(b.bigram) || !num(b.slowdownPct, -100, 1000) || Object.keys(b).length !== 2) return { ok: false, error: 'slowBigrams item' };
  }
  if (!Array.isArray(p.weakKeys) || p.weakKeys.length > 10) return { ok: false, error: 'weakKeys' };
  for (const k of p.weakKeys) {
    if (!k || typeof k.key !== 'string' || !/^[a-z]$/.test(k.key) || !num(k.errorRate, 0, 100) || Object.keys(k).length !== 2) return { ok: false, error: 'weakKeys item' };
  }
  return { ok: true, value: p };
}

/** JSON schema the LLM must answer with (also used to validate its reply). */
export const COACH_PLAN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'drills', 'tips'],
  properties: {
    summary: { type: 'string' },
    drills: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'minutes', 'text'],
        properties: { title: { type: 'string' }, minutes: { type: 'integer' }, text: { type: 'string' } },
      },
    },
    tips: { type: 'array', items: { type: 'string' } },
  },
});

/** System prompt for the coach endpoint. */
export const COACH_SYSTEM_PROMPT =
  'You are a touch-typing coach. You receive aggregated statistics from a typing analyzer: average net WPM, ' +
  'accuracy, rhythm consistency, fatigue (percent change from first to second half), the slowest letter pairs ' +
  "(bigrams, with percent slowdown versus the typist's median) and the keys with the highest error rates. " +
  'Write a one-week practice plan. Give a two-sentence summary, three to five drills (each with a title, ' +
  'minutes per day, and a practice line of 8 to 15 lowercase words that concentrate on the weak bigrams and keys), ' +
  'and up to four short tips. If accuracy is below 95%, prioritise accuracy over speed.';

/**
 * Validate an LLM plan against COACH_PLAN_SCHEMA and clamp lengths.
 * @param {unknown} plan Candidate.
 * @returns {{summary:string, drills:{title:string,minutes:number,text:string}[], tips:string[]}|null}
 */
export function sanitizePlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const p = /** @type {any} */ (plan);
  if (typeof p.summary !== 'string' || !Array.isArray(p.drills) || !Array.isArray(p.tips)) return null;
  const drills = p.drills
    .filter((d) => d && typeof d.title === 'string' && typeof d.text === 'string')
    .slice(0, 6)
    .map((d) => ({
      title: d.title.slice(0, 80),
      minutes: Math.max(1, Math.min(30, Math.round(Number(d.minutes) || 5))),
      text: d.text
        .toLowerCase()
        .replace(/[^a-z ,.';-]/g, '')
        .slice(0, 200),
    }));
  if (!drills.length) return null;
  return {
    summary: p.summary.slice(0, 400),
    drills,
    tips: p.tips
      .filter((t) => typeof t === 'string')
      .slice(0, 5)
      .map((t) => t.slice(0, 200)),
  };
}

/**
 * Deterministic offline plan (graceful fallback).
 * @param {CoachPayload} payload Aggregated stats.
 * @returns {{source:'offline', summary:string, drills:{title:string,minutes:number,text:string}[], tips:string[]}}
 */
export function offlinePlan(payload) {
  const drills = [];
  for (const b of payload.slowBigrams.slice(0, 3)) {
    const words = practiceWords(b.bigram, 6);
    const line = (words.length ? words : [b.bigram]).concat(b.bigram.repeat(2)).join(' ');
    drills.push({ title: `Smooth out '${b.bigram}'`, minutes: 5, text: line });
  }
  if (payload.weakKeys.length) {
    const ks = payload.weakKeys.slice(0, 3).map((k) => k.key);
    drills.push({ title: `Accuracy on ${ks.map((k) => `'${k}'`).join(', ')}`, minutes: 5, text: ks.map((k) => practiceWords(k, 3).join(' ')).join(' ') });
  }
  if (!drills.length) drills.push({ title: 'Steady rhythm', minutes: 10, text: 'the quick steady hand keeps time and never rushes the next key' });
  const tips = [];
  if (payload.avgAccuracy < 95) tips.push('Slow down by 10% until accuracy stays above 96%; speed follows accuracy.');
  if (payload.avgConsistency < 60) tips.push('Type to an even beat. A metronome at a comfortable tempo helps.');
  if (payload.fatigueChangePct < -10) tips.push('You fade late in runs: add one 120 s timed run per day for stamina.');
  tips.push('Keep eyes on the screen and return to the home row after every reach.');
  return {
    source: 'offline',
    summary: `Across ${payload.runs} runs you average ${payload.avgWpm} WPM at ${payload.avgAccuracy}% accuracy. This plan targets your slowest transitions and least accurate keys.`,
    drills,
    tips,
  };
}
