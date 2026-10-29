/**
 * Phishing-spot typing: a mixed list of URLs. Type a URL to flag it as suspicious, or press
 * Enter on an empty line to mark it safe. Scores typing speed plus detection accuracy.
 * Uses only reserved / fictional domains and documentation IP ranges.
 * @module core/modes/phishing
 */
import { generatePhishingSet } from '../corpus/security.js';
import { completeAtEnd } from './_shared.js';

/**
 * Score a set of decisions.
 * @param {{url:string,suspicious:boolean}[]} items URL list.
 * @param {('flag'|'safe')[]} decisions One decision per item.
 * @returns {{tp:number,fp:number,tn:number,fn:number,precision:number,recall:number,detectionAccuracy:number}}
 */
export function scorePhishing(items, decisions) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  items.forEach((item, i) => {
    const flagged = decisions[i] === 'flag';
    if (item.suspicious && flagged) tp++;
    else if (!item.suspicious && flagged) fp++;
    else if (!item.suspicious && !flagged) tn++;
    else fn++;
  });
  const total = items.length || 1;
  return {
    tp,
    fp,
    tn,
    fn,
    precision: tp + fp ? Math.round((tp / (tp + fp)) * 1000) / 10 : 0,
    recall: tp + fn ? Math.round((tp / (tp + fn)) * 1000) / 10 : 0,
    detectionAccuracy: Math.round(((tp + tn) / total) * 1000) / 10,
  };
}

/**
 * Combined phishing score: net WPM on flagged URLs weighted by detection accuracy squared.
 * @param {number} netWpm Net WPM across typed URLs.
 * @param {number} detectionAccuracy Percentage 0-100.
 * @returns {number}
 */
export function phishingScore(netWpm, detectionAccuracy) {
  const s = (Number.isFinite(netWpm) ? netWpm : 0) * (detectionAccuracy / 100) ** 2;
  return Math.round(s * 10) / 10;
}

/**
 * Create a phishing session (a deterministic list of URLs).
 * @param {number} seed Seed.
 * @param {number} [count=8] Number of URLs.
 */
export function createPhishingSession(seed, count = 8) {
  return { seed, items: generatePhishingSet(seed, count), decisions: [] };
}

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'phishing',
  label: 'Phishing spot',
  category: 'security',
  defaults: { count: 8 },
  /** Each round's text is a single URL; the UI drives rounds via createPhishingSession. */
  generate(seed, o) {
    const s = createPhishingSession(seed, o.count || 8);
    return { text: s.items[0].url, meta: { items: s.items } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: false, minChars: 0, minAccuracy: 0, boardKey: () => 'phishing' },
};
