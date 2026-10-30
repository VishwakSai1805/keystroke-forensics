import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createRunService } from '../../server/runService.js';
import { createMemoryStore } from '../../server/memoryStore.js';
import { createPgStore } from '../../server/pgStore.js';
import { createEngine } from '../../core/engine.js';
import { typeKeys, keysOf } from '../helpers/typist.js';

/**
 * Store contract: the in-memory store (dev server) and the Postgres store (Render) must
 * behave identically. The Postgres suite runs on PGlite, a real Postgres compiled to WASM.
 */
const SECRET = 'store-contract-secret-123';

function typeToken(tok, typist = {}) {
  const e = createEngine({ modeId: tok.modeId, options: tok.options, policy: tok.policy });
  e.load({ seed: tok.seed });
  typeKeys(e, keysOf(e.getSnapshot().text), typist);
  return e.entries();
}

const factories = {
  memory: async () => createMemoryStore(),
  postgres: async () => {
    const pg = new PGlite();
    return createPgStore({ query: (text, params) => pg.query(text, params), exec: (sql) => pg.exec(sql) });
  },
};

describe.each(Object.keys(factories))('%s store', (kind) => {
  let store;
  let t = 1_800_000_000_000;
  let svc;
  beforeAll(async () => {
    store = await factories[kind]();
    svc = createRunService({ store, secret: SECRET, now: () => t });
  });

  async function play(userId, typist, options = { count: 10 }) {
    const tok = await svc.issue({ userId, ip: `ip-${userId}`, modeId: 'words', options });
    t += 120_000;
    const res = await svc.submit({ userId, ip: `ip-${userId}`, runId: tok.runId, nonce: tok.nonce, entries: typeToken(tok, typist) });
    return { tok, res };
  }

  it('verifies a genuine run and ranks it', async () => {
    const { res } = await play('alice');
    expect(res).toMatchObject({ status: 'accepted', qualified: true });
    const board = await store.leaderboard({ board: 'words:10', period: 'daily', userId: 'alice', now: t });
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ rank: 1, is_me: true, handle: expect.stringMatching(/^typist-/) });
    expect(typeof board[0].score).toBe('number');
  });

  it('consumes tokens exactly once (replay protection)', async () => {
    const tok = await svc.issue({ userId: 'alice', ip: 'ip', modeId: 'words', options: { count: 10 } });
    const entries = typeToken(tok);
    t += 60_000;
    await svc.submit({ userId: 'alice', ip: 'ip', runId: tok.runId, nonce: tok.nonce, entries });
    await expect(svc.submit({ userId: 'alice', ip: 'ip', runId: tok.runId, nonce: tok.nonce, entries })).rejects.toMatchObject({ status: 400 });
    expect(await store.consumeToken(tok.runId, t)).toBe(false);
  });

  it('shadow-bans bots: accepted response, absent from the public board, visible to the owner', async () => {
    const { res } = await play('bot', { mean: 8, jitter: 0, dwell: 4, dwellJitter: 0 }, { count: 25 });
    expect(res).toMatchObject({ status: 'accepted', qualified: true });
    expect(await store.leaderboard({ board: 'words:25', period: 'alltime', userId: 'x', now: t })).toHaveLength(0);
    expect((await store.personal({ userId: 'bot', now: t })).bests).toHaveLength(1);
  });

  it('keeps the best score per user and orders the board', async () => {
    await play('bob', { mean: 90 });
    await play('bob', { mean: 300 });
    const board = await store.leaderboard({ board: 'words:10', period: 'weekly', userId: 'bob', now: t });
    expect(board.filter((r) => r.is_me)).toHaveLength(1);
    for (let i = 1; i < board.length; i++) expect(board[i - 1].score).toBeGreaterThanOrEqual(board[i].score);
  });

  it('handles, cohorts and cohort-scoped boards', async () => {
    await expect(store.setHandle('alice', 'x')).rejects.toMatchObject({ status: 400 });
    expect(await store.setHandle('alice', 'alice_k')).toEqual({ handle: 'alice_k' });
    await expect(store.setHandle('bob', 'alice_k')).rejects.toMatchObject({ status: 409 });
    const { code } = await store.createCohort('alice', 'Lab B');
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    await expect(store.joinCohort('bob', 'ZZZZZZ')).rejects.toMatchObject({ status: 404 });
    expect(await store.myCohorts('alice')).toEqual([{ name: 'Lab B', code }]);
    const scoped = await store.leaderboard({ board: 'words:10', period: 'alltime', cohort: code, userId: 'alice', now: t });
    expect(scoped.map((r) => r.handle)).toEqual(['alice_k']);
    const outsider = await store.leaderboard({ board: 'words:10', period: 'alltime', cohort: code, userId: 'bob', now: t });
    if (kind === 'postgres') expect(outsider).toHaveLength(0);
  });

  it('personal trend and history', async () => {
    const p = await store.personal({ userId: 'alice', now: t });
    expect(p.trend.length).toBeGreaterThan(0);
    expect((await store.history('alice', 'words:10', 20)).length).toBeGreaterThan(0);
  });

  it('rate-limit buckets count within the window', async () => {
    expect(await store.hit('k', 60_000, t)).toBe(1);
    expect(await store.hit('k', 60_000, t + 1)).toBe(2);
    expect(await store.hit('k', 60_000, t + 120_000)).toBe(1);
  });

  it('deletes a user and everything they own', async () => {
    await store.deleteUser('bob');
    const board = await store.leaderboard({ board: 'words:10', period: 'alltime', userId: 'bob', now: t });
    expect(board.some((r) => r.is_me)).toBe(false);
    expect(await store.history('bob', 'words:10', 20)).toEqual([]);
  });
});
