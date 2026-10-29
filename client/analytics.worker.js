/**
 * Analytics Web Worker: heavy computation (bigram stats, consistency, burst, keyboard heat,
 * keystroke-dynamics features) off the main thread so typing stays under one frame.
 */
import { analyzeRun, perKeyStats, keyboardHeat } from '../core/analysis.js';
import { consistency, interKeyIntervals, burstWpm, round } from '../core/metrics.js';
import { featureVector, liveVector, identityConfidence } from '../core/dynamics.js';

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'live') {
      const { entries, startT, now, layout, profile } = msg;
      const elapsed = startT === null ? 0 : Math.max(0, now - startT);
      const out = {
        type: 'live',
        id: msg.id,
        consistency: round(consistency(interKeyIntervals(entries))),
        burst: round(burstWpm(entries, elapsed)),
        heat: keyboardHeat(perKeyStats(entries), layout),
        identity: profile ? identityConfidence(profile, liveVector(entries).vector) : null,
      };
      self.postMessage(out);
    } else if (msg.type === 'analyze') {
      const analysis = analyzeRun(msg.run);
      const vector = msg.wantVector ? featureVector(msg.run.entries) : null;
      self.postMessage({ type: 'analysis', id: msg.id, analysis, vector });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: String(err && err.message ? err.message : err) });
  }
};
