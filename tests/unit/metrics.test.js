import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  grossWpm,
  netWpm,
  rawAccuracy,
  finalAccuracy,
  countUncorrected,
  consistency,
  leaderboardScore,
  burstWpm,
  wpmSeries,
  fatigue,
  flowState,
  trimOutliers,
  computeCoreMetrics,
  finite,
} from '../../core/metrics.js';

const entry = (tDown, correct = true, op = 'char') => ({ kind: 'key', key: 'a', code: 'KeyA', op, pos: 0, expected: 'a', correct, tDown, tUp: tDown + 80, isTrusted: true });

describe('worked examples from the README', () => {
  it('gross WPM: 250 chars in 60 s = 50 WPM', () => expect(grossWpm(250, 60000)).toBe(50));
  it('net WPM: 250 chars, 10 uncorrected, 60 s = 48 WPM', () => expect(netWpm(250, 10, 60000)).toBe(48));
  it('raw accuracy counts corrected errors', () => expect(rawAccuracy(95, 100)).toBe(95));
  it('final accuracy is judged on the end text', () => {
    expect(countUncorrected('helo world', 'hello world')).toBe(7);
    expect(finalAccuracy('hello world', 'hello world')).toBe(100);
    expect(finalAccuracy('hellx', 'hello')).toBe(80);
  });
  it('leaderboard score: 80 WPM at 95% = 72.2', () => expect(leaderboardScore(80, 95)).toBe(72.2));
  it('consistency: perfectly even rhythm = 100', () => expect(consistency([100, 100, 100, 100])).toBe(100));
});

describe('edge cases never leak NaN or Infinity', () => {
  it('zero elapsed time', () => {
    expect(grossWpm(10, 0)).toBe(0);
    expect(netWpm(10, 0, 0)).toBe(0);
    expect(burstWpm([entry(0)], 0)).toBe(0);
  });
  it('empty input', () => {
    expect(rawAccuracy(0, 0)).toBe(0);
    expect(finalAccuracy('', 'abc')).toBe(0);
    expect(consistency([])).toBe(0);
    expect(wpmSeries([], null, null)).toEqual([]);
    expect(fatigue([], 0, 0)).toEqual({ slopePerMin: 0, firstHalf: 0, secondHalf: 0, changePct: 0 });
    expect(flowState([], 0, 0).flowMs).toBe(0);
  });
  it('more errors than chars floors net WPM at zero', () => expect(netWpm(5, 9, 60000)).toBe(0));
  it('finite() coerces garbage', () => {
    expect(finite(NaN)).toBe(0);
    expect(finite(Infinity, 3)).toBe(3);
  });
  it('computeCoreMetrics on an empty run returns all-finite numbers', () => {
    const m = computeCoreMetrics({ text: 'abc', typed: '', entries: [], startT: null, endT: null });
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
  });
  it('trimOutliers drops 3-sigma outliers', () => {
    const xs = [...Array(30).fill(100), 5000];
    expect(trimOutliers(xs)).not.toContain(5000);
  });
});

describe('time-based metrics', () => {
  it('burst WPM finds the best 5 s window', () => {
    const slow = Array.from({ length: 10 }, (_, i) => entry(i * 1000));
    const fast = Array.from({ length: 50 }, (_, i) => entry(20000 + i * 100));
    expect(burstWpm([...slow, ...fast], 30000)).toBeCloseTo(50 / 5 / (5000 / 60000), 5);
  });
  it('series is sampled every 500 ms and ends at the run end', () => {
    const es = Array.from({ length: 20 }, (_, i) => entry(1000 + i * 150));
    const s = wpmSeries(es, 1000, 4000);
    expect(s.map((p) => p.t)).toEqual([500, 1000, 1500, 2000, 2500, 3000]);
  });
  it('fatigue detects a slowdown in the second half', () => {
    const first = Array.from({ length: 40 }, (_, i) => entry(i * 100));
    const second = Array.from({ length: 20 }, (_, i) => entry(4000 + i * 200));
    const f = fatigue([...first, ...second], 0, 8000);
    expect(f.secondHalf).toBeLessThan(f.firstHalf);
    expect(f.changePct).toBeLessThan(0);
  });
  it('flow detector finds an even, accurate stretch', () => {
    const es = Array.from({ length: 60 }, (_, i) => entry(i * 120));
    expect(flowState(es, 0, 7200).flowPct).toBeGreaterThan(50);
  });
});

describe('properties (fast-check)', () => {
  it('accuracy is always within [0, 100]', () => {
    fc.assert(
      fc.property(fc.nat(10000), fc.nat(10000), (a, b) => {
        const r = rawAccuracy(Math.min(a, b), Math.max(a, b));
        return r >= 0 && r <= 100;
      }),
    );
    fc.assert(
      fc.property(fc.string(), fc.string(), (typed, text) => {
        const f = finalAccuracy(typed, text);
        return f >= 0 && f <= 100;
      }),
    );
  });
  it('WPM is always >= 0 and finite', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 100000 }), fc.integer({ min: -1000, max: 100000 }), fc.integer({ min: -10, max: 3600000 }), (c, u, ms) => {
        const g = grossWpm(c, ms);
        const n = netWpm(c, u, ms);
        return g >= 0 && n >= 0 && Number.isFinite(g) && Number.isFinite(n);
      }),
    );
  });
  it('consistency is within [0, 100] for any intervals', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 5000, noNaN: true })), (iv) => {
        const c = consistency(iv);
        return c >= 0 && c <= 100;
      }),
    );
  });
});
