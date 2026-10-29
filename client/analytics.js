/**
 * Promise wrapper around the analytics worker, with a main-thread fallback when module
 * workers are unavailable.
 * @module client/analytics
 */

/**
 * @param {URL|string|(()=>Worker)} source URL of analytics.worker.js, or a factory (e.g. Vite's `?worker` import).
 */
export function createAnalytics(source) {
  let worker = null;
  let seq = 0;
  const pending = new Map();
  try {
    worker = typeof source === 'function' ? source() : new Worker(source, { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.type === 'error') p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    worker.onerror = () => {
      worker = null;
    };
  } catch {
    worker = null;
  }

  async function local(msg) {
    const [{ analyzeRun, perKeyStats, keyboardHeat }, m, d] = await Promise.all([import('../core/analysis.js'), import('../core/metrics.js'), import('../core/dynamics.js')]);
    if (msg.type === 'live') {
      const elapsed = msg.startT === null ? 0 : Math.max(0, msg.now - msg.startT);
      return {
        consistency: m.round(m.consistency(m.interKeyIntervals(msg.entries))),
        burst: m.round(m.burstWpm(msg.entries, elapsed)),
        heat: keyboardHeat(perKeyStats(msg.entries), msg.layout),
        identity: msg.profile ? d.identityConfidence(msg.profile, d.liveVector(msg.entries).vector) : null,
      };
    }
    return { analysis: analyzeRun(msg.run), vector: msg.wantVector ? d.featureVector(msg.run.entries).vector : null };
  }

  function post(msg) {
    if (!worker) return local(msg);
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id });
    }).catch(() => local(msg));
  }

  return {
    /** Live telemetry (consistency, burst, heat, identity confidence). */
    live: (payload) => post({ type: 'live', ...payload }),
    /** Full post-run analysis; optionally a biometric feature vector. */
    analyze: async (run, wantVector = false) => {
      const r = await post({ type: 'analyze', run, wantVector });
      return { analysis: r.analysis, vector: r.vector && r.vector.vector ? r.vector.vector : r.vector };
    },
  };
}
