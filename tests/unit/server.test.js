import { describe, it, expect, vi } from 'vitest';
import { createRunService, LIMITS } from '../../server/runService.js';
import { createMemoryStore } from '../../server/memoryStore.js';
import { createCoachService } from '../../server/coachService.js';
import { createEngine } from '../../core/engine.js';
import { typeKeys, keysOf } from '../helpers/typist.js';

const SECRET = 'server-test-secret-xyz';

function setup(now = () => Date.now()) {
  const store = createMemoryStore();
  const svc = createRunService({ store, secret: SECRET, now });
  return { store, svc };
}

function typeToken(tok, typist = {}) {
  const e = createEngine({ modeId: tok.modeId, options: tok.options, policy: tok.policy });
  e.load({ seed: tok.seed });
  typeKeys(e, keysOf(e.getSnapshot().text), typist);
  return e.entries();
}

describe('run service', () => {
  it('requires a strong secret', () => {
    expect(() => createRunService({ store: createMemoryStore(), secret: 'short' })).toThrow();
  });
  it('issues tokens without leaking the text hash or owner', async () => {
    const { svc } = setup();
    const tok = await svc.issue({ userId: 'u1', ip: '1.1.1.1', modeId: 'words', options: { count: 10 } });
    expect(tok).toHaveProperty('signature');
    expect(tok).toHaveProperty('text');
    expect(tok).not.toHaveProperty('textHash');
    expect(tok).not.toHaveProperty('userId');
  });
  it('verifies a genuine submission and shows it on the leaderboard', async () => {
    let t = 1_800_000_000_000;
    const { svc, store } = setup(() => t);
    const tok = await svc.issue({ userId: 'u1', ip: 'ip', modeId: 'words', options: { count: 10 } });
    t += 120_000;
    const res = await svc.submit({ userId: 'u1', ip: 'ip', runId: tok.runId, nonce: tok.nonce, entries: typeToken(tok) });
    expect(res).toMatchObject({ status: 'accepted', qualified: true });
    const board = await store.leaderboard({ board: 'words:10', period: 'daily', userId: 'u1', now: t });
    expect(board).toHaveLength(1);
    expect(board[0].is_me).toBe(true);
  });
  it('rejects another user submitting my token, and a second submission of the same token', async () => {
    const { svc } = setup();
    const tok = await svc.issue({ userId: 'u1', ip: 'ip', modeId: 'words', options: { count: 10 } });
    const entries = typeToken(tok);
    await expect(svc.submit({ userId: 'u2', ip: 'ip', runId: tok.runId, nonce: tok.nonce, entries })).rejects.toMatchObject({ status: 400 });
    await svc.submit({ userId: 'u1', ip: 'ip', runId: tok.runId, nonce: tok.nonce, entries });
    await expect(svc.submit({ userId: 'u1', ip: 'ip', runId: tok.runId, nonce: tok.nonce, entries })).rejects.toMatchObject({ status: 400 });
  });
  it('shadow-bans: a bot gets the same response shape as a human but never reaches the board', async () => {
    let t = 1_800_000_000_000;
    const { svc, store } = setup(() => t);
    const tok = await svc.issue({ userId: 'bot', ip: 'ip', modeId: 'words', options: { count: 25 } });
    t += 120_000;
    const res = await svc.submit({ userId: 'bot', ip: 'ip', runId: tok.runId, nonce: tok.nonce, entries: typeToken(tok, { mean: 8, jitter: 0, dwell: 4, dwellJitter: 0 }) });
    expect(Object.keys(res).sort()).toEqual(['qualified', 'result', 'runId', 'status']);
    expect(res.status).toBe('accepted');
    expect(res.qualified).toBe(true);
    expect(await store.leaderboard({ board: 'words:25', period: 'alltime', userId: 'bot', now: t })).toHaveLength(0);
    expect(store._data().runs[0].status).toBe('quarantined');
    expect((await store.personal({ userId: 'bot', now: t })).bests).toHaveLength(1);
  });
  it('rate-limits submissions per user', async () => {
    const { svc } = setup();
    const calls = [];
    for (let i = 0; i <= LIMITS.submitPerMinUser; i++) calls.push(svc.submit({ userId: 'spam', ip: 'ip', runId: 'x', nonce: 'y', entries: [] }).catch((e) => e.status));
    const statuses = await Promise.all(calls);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
  it('rejects tokens for unranked modes', async () => {
    const { svc } = setup();
    await expect(svc.issue({ userId: 'u', ip: 'ip', modeId: 'custom', options: {} })).rejects.toMatchObject({ status: 400 });
  });
  it('cohort boards only include members', async () => {
    let t = 1_800_000_000_000;
    const { svc, store } = setup(() => t);
    const { code } = await store.createCohort('alice', 'Lab B');
    for (const u of ['alice', 'mallory']) {
      const tok = await svc.issue({ userId: u, ip: u, modeId: 'words', options: { count: 10 } });
      t += 60_000;
      await svc.submit({ userId: u, ip: u, runId: tok.runId, nonce: tok.nonce, entries: typeToken(tok) });
    }
    expect(await store.leaderboard({ board: 'words:10', period: 'alltime', userId: 'alice', now: t })).toHaveLength(2);
    expect(await store.leaderboard({ board: 'words:10', period: 'alltime', cohort: code, userId: 'alice', now: t })).toHaveLength(1);
  });
});

describe('coach service', () => {
  const stats = { runs: 3, avgWpm: 55, avgAccuracy: 96, avgConsistency: 70, fatigueChangePct: -5, slowBigrams: [{ bigram: 'th', slowdownPct: 38 }], weakKeys: [{ key: 'q', errorRate: 12 }] };
  it('falls back to the offline plan without an API key', async () => {
    const plan = await createCoachService({ anthropic: null }).plan(stats);
    expect(plan.source).toBe('offline');
  });
  it('rejects payloads that are not aggregated stats', async () => {
    await expect(createCoachService({ anthropic: null }).plan({ ...stats, keystrokes: [1, 2] })).rejects.toMatchObject({ status: 400 });
  });
  it('sends only the validated stats to Claude and validates the reply', async () => {
    const create = vi.fn(async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ summary: 'ok', drills: [{ title: 'th', minutes: 5, text: 'the that this' }], tips: ['relax'] }) }],
    }));
    const plan = await createCoachService({ anthropic: { beta: { messages: { create } } } }).plan(stats);
    expect(plan.source).toBe('claude');
    const req = create.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.messages[0].content).toContain('"slowBigrams"');
    expect(req.messages[0].content).not.toContain('tDown');
  });
  it('falls back when Claude refuses', async () => {
    const create = vi.fn(async () => ({ stop_reason: 'refusal', content: [] }));
    const plan = await createCoachService({ anthropic: { beta: { messages: { create } } } }).plan(stats);
    expect(plan.source).toBe('offline');
  });
});
