import { describe, it, expect } from 'vitest';
import { issueRunToken, verifySubmission, analyzeLogIntegrity, zScore, hmacSign, hmacVerify, canonicalJson } from '../../core/verify.js';
import { createEngine } from '../../core/engine.js';
import { typeKeys, keysOf } from '../helpers/typist.js';

const SECRET = 'test-secret-0123456789';
const NOW = 1_800_000_000_000;

async function play(modeId, options, typist = {}, mutate) {
  const { token, text } = await issueRunToken({ secret: SECRET, userId: 'u1', modeId, options, now: NOW });
  const e = createEngine({ modeId, options: token.options });
  e.load({ seed: token.seed });
  expect(e.getSnapshot().text).toBe(text);
  const keys = mutate ? mutate(keysOf(text)) : keysOf(text);
  typeKeys(e, keys, { seed: 3, ...typist });
  e.tick(1e12);
  return { token, entries: e.entries(), result: e.getSnapshot().result };
}

describe('crypto helpers', () => {
  it('HMAC sign/verify round-trips and rejects tampering', async () => {
    const sig = await hmacSign(SECRET, 'msg');
    expect(await hmacVerify(SECRET, 'msg', sig)).toBe(true);
    expect(await hmacVerify(SECRET, 'msg2', sig)).toBe(false);
    expect(await hmacVerify('other', 'msg', sig)).toBe(false);
    expect(await hmacVerify(SECRET, 'msg', 'zz')).toBe(false);
  });
  it('canonical JSON sorts keys', () => expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}'));
});

describe('server verification', () => {
  it('a genuine human-like log passes and metrics are recomputed server-side', async () => {
    const { token, entries, result } = await play('words', { count: 25 });
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 60_000, nonceUsed: false });
    expect(v.verdict).toBe('verified');
    expect(v.result.netWpm).toBe(result.netWpm);
  });
  it('ignores a forged claimed score: metrics come from the log only', async () => {
    const { token, entries } = await play('words', { count: 25 });
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 60_000, nonceUsed: false, claimedScore: 999 });
    expect(v.result.score).toBeLessThan(200);
  });
  it('rejects a forged signature', async () => {
    const { token, entries } = await play('words', { count: 25 });
    const forged = { ...token, seed: token.seed + 1 };
    expect((await verifySubmission({ secret: SECRET, token: forged, entries, now: NOW + 60_000, nonceUsed: false })).verdict).toBe('rejected');
    const wrongKey = { ...token, signature: await hmacSign('attacker', 'x') };
    expect((await verifySubmission({ secret: SECRET, token: wrongKey, entries, now: NOW + 60_000, nonceUsed: false })).reasons).toEqual(['bad-signature']);
  });
  it('rejects a replayed nonce', async () => {
    const { token, entries } = await play('words', { count: 25 });
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 60_000, nonceUsed: true });
    expect(v).toMatchObject({ verdict: 'rejected', reasons: ['replayed-nonce'] });
  });
  it('rejects an expired token', async () => {
    const { token, entries } = await play('words', { count: 25 });
    expect((await verifySubmission({ secret: SECRET, token, entries, now: token.expiresAt + 1, nonceUsed: false })).reasons).toEqual(['expired']);
  });
  it('quarantines a bot: 10 ms intervals with zero variance', async () => {
    const { token, entries } = await play('words', { count: 25 }, { mean: 10, jitter: 0, dwellJitter: 0, dwell: 5 });
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 60_000, nonceUsed: false });
    expect(v.verdict).toBe('quarantined');
    expect(v.reasons).toEqual(expect.arrayContaining(['superhuman-interval', 'uniform-timing', 'uniform-dwell']));
  });
  it('quarantines a metronomic macro even at human speed', async () => {
    const { token, entries } = await play('words', { count: 25 }, { mean: 120, jitter: 0.01, dwellJitter: 0.01 });
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 60_000, nonceUsed: false });
    expect(v.reasons).toContain('uniform-timing');
  });
  it('quarantines untrusted (synthetic) events', async () => {
    const { token, entries } = await play('words', { count: 25 }, { isTrusted: false });
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 60_000, nonceUsed: false });
    expect(v.verdict).toBe('quarantined');
    expect(v.reasons).toContain('untrusted-event');
  });
  it('quarantines paste-injected logs', async () => {
    const { token, entries } = await play('words', { count: 25 });
    const injected = [
      ...entries.slice(0, 5),
      { kind: 'paste', key: '', code: '', op: null, pos: null, expected: null, correct: null, tDown: entries[5].tDown - 1, tUp: null, isTrusted: true },
      ...entries.slice(5),
    ];
    const v = await verifySubmission({ secret: SECRET, token, entries: injected, now: NOW + 60_000, nonceUsed: false });
    expect(v.reasons).toContain('paste-detected');
  });
  it('quarantines logs whose keydown/keyup pairs are missing', async () => {
    const { token, entries } = await play('words', { count: 25 });
    const stripped = entries.map((e) => ({ ...e, tUp: null }));
    const v = await verifySubmission({ secret: SECRET, token, entries: stripped, now: NOW + 60_000, nonceUsed: false });
    expect(v.reasons).toContain('missing-keyup');
  });
  it('quarantines a run submitted faster than its own duration (pre-generated log)', async () => {
    const { token, entries } = await play('timed', { duration: 30 });
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 5_000, nonceUsed: false });
    expect(v.reasons).toContain('wall-clock');
  });
  it('quarantines forged client hints', async () => {
    const { token, entries } = await play('words', { count: 25 });
    const forged = entries.map((e, i) => (i === 3 ? { ...e, correct: !e.correct } : e));
    const v = await verifySubmission({ secret: SECRET, token, entries: forged, now: NOW + 60_000, nonceUsed: false });
    expect(v.reasons).toContain('hint-mismatch');
  });
  it('flags a WPM spike against the user history', async () => {
    const { token, entries } = await play('words', { count: 25 });
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 60_000, nonceUsed: false, history: [20, 21, 19, 22, 20, 21] });
    expect(v.verdict).toBe('quarantined');
    expect(v.reasons.some((r) => r.startsWith('wpm-spike'))).toBe(true);
  });
  it('marks sloppy runs unqualified (< 90% accuracy)', async () => {
    const { token, entries } = await play('words', { count: 25 }, {}, (keys) => keys.map((k, i) => (i % 4 === 0 && k !== ' ' ? 'q' : k)));
    const v = await verifySubmission({ secret: SECRET, token, entries, now: NOW + 60_000, nonceUsed: false });
    expect(v.verdict).toBe('unqualified');
  });
  it('rejects malformed payloads', async () => {
    const { token } = await play('words', { count: 25 });
    for (const bad of [null, [], [{ kind: 'key' }], 'x', Array(30000).fill({})]) {
      expect((await verifySubmission({ secret: SECRET, token, entries: bad, now: NOW + 60_000, nonceUsed: false })).verdict).toBe('rejected');
    }
  });
  it('refuses tokens for unranked modes and binds daily to the UTC day', async () => {
    await expect(issueRunToken({ secret: SECRET, userId: 'u', modeId: 'custom', now: NOW })).rejects.toThrow(/not ranked/);
    const { token } = await issueRunToken({ secret: SECRET, userId: 'u', modeId: 'daily', options: { day: '1999-01-01' }, now: NOW });
    expect(token.options.day).toBe(new Date(NOW).toISOString().slice(0, 10));
  });
  it('integrity and z-score helpers', () => {
    expect(analyzeLogIntegrity([])).toEqual([]);
    expect(zScore([1, 2], 100).spike).toBe(false);
  });
});
