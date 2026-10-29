import { describe, it, expect } from 'vitest';
import { featureVector, enrollProfile, identityConfidence, evaluateVerifier, syntheticImpostors, distance, MIN_ENROLL_RUNS, FEATURE_NAMES } from '../../core/dynamics.js';
import { session } from '../helpers/typist.js';

const run = (seed, dwell = 90, mean = 160) => session({ modeId: 'words', options: { count: 50 }, seed, typist: { seed, dwell, mean, dwellJitter: 0.3, jitter: 0.3 } }).engine.entries();

describe('keystroke dynamics', () => {
  it('extracts a fixed-length vector with dwell and flight features', () => {
    const { vector } = featureVector(run(1));
    expect(vector).toHaveLength(FEATURE_NAMES.length);
    expect(vector[FEATURE_NAMES.indexOf('dwell:mean')]).toBeGreaterThan(50);
  });
  it('refuses to enroll with fewer than 5 runs', () => {
    expect(() => enrollProfile([featureVector(run(1)).vector])).toThrow(/at least 5/);
  });
  it('separates a genuine typist from a different rhythm', () => {
    const vectors = Array.from({ length: MIN_ENROLL_RUNS + 1 }, (_, i) => featureVector(run(10 + i)).vector);
    const profile = enrollProfile(vectors);
    const genuine = identityConfidence(profile, featureVector(run(99)).vector);
    const impostor = identityConfidence(profile, featureVector(run(98, 180, 260)).vector);
    expect(genuine.confidence).toBeGreaterThan(impostor.confidence);
    expect(profile).not.toHaveProperty('text');
  });
  it('computes FAR/FRR/EER/ROC', () => {
    const vectors = Array.from({ length: 6 }, (_, i) => featureVector(run(20 + i)).vector);
    const profile = enrollProfile(vectors);
    const imp = syntheticImpostors(vectors, 1, 12).map((v) => distance(profile, v));
    const ev = evaluateVerifier(profile.genuine, imp);
    expect(ev.roc.length).toBeGreaterThan(2);
    expect(ev.eer).toBeGreaterThanOrEqual(0);
    expect(ev.eer).toBeLessThanOrEqual(100);
    expect(ev.auc).toBeGreaterThanOrEqual(0);
    expect(evaluateVerifier([], [1]).roc).toEqual([]);
  });
});
