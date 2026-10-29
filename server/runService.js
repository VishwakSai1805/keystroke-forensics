/**
 * Platform-neutral leaderboard service: token issue, verified submission, rate limits.
 * All trust decisions happen here, on the server. Storage is injected (Supabase in the
 * Edge Functions, an in-memory/JSON store for the local dev server and tests).
 * @module server/runService
 */
import { issueRunToken, verifySubmission } from '../core/verify.js';
import { boardKey as boardKeyOf } from '../core/modes/index.js';

export const LIMITS = Object.freeze({ tokenPerMinUser: 30, tokenPerMinIp: 90, submitPerMinUser: 10, submitPerMinIp: 30 });

/** HTTP-flavoured error. */
export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * @typedef {Object} RunStore
 * @property {(key:string, windowMs:number, now:number)=>Promise<number>} hit Increment a rate-limit bucket; returns count in window.
 * @property {(token:Object)=>Promise<void>} saveToken
 * @property {(runId:string)=>Promise<Object|null>} getToken
 * @property {(runId:string, now:number)=>Promise<boolean>} consumeToken Atomically mark used; false if already consumed.
 * @property {(userId:string, board:string, n:number)=>Promise<number[]>} history Recent verified scores.
 * @property {(run:Object, entries:Object[])=>Promise<void>} saveRun
 * @property {(board:string)=>Promise<void>} [notify] Broadcast a leaderboard change.
 */

/**
 * @param {{store:RunStore, secret:string, now?:()=>number}} deps
 */
export function createRunService({ store, secret, now = () => Date.now() }) {
  if (!secret || secret.length < 16) throw new Error('RUN_TOKEN_SECRET must be at least 16 characters');
  const limited = async (key, max) => (await store.hit(key, 60_000, now())) > max;

  return {
    /**
     * Issue a signed run token. Returns {runId, seed, text, nonce, issuedAt, expiresAt, signature, modeId, options, policy}.
     */
    async issue({ userId, ip, modeId, options, policy }) {
      if (!userId) throw httpError(401, 'unauthenticated');
      if ((await limited(`tok:u:${userId}`, LIMITS.tokenPerMinUser)) || (await limited(`tok:ip:${ip}`, LIMITS.tokenPerMinIp))) throw httpError(429, 'rate limited');
      let issued;
      try {
        issued = await issueRunToken({ secret, userId, modeId, options, policy, now: now() });
      } catch (e) {
        throw httpError(400, e.message);
      }
      await store.saveToken(issued.token);
      const { userId: _u, textHash: _h, ...pub } = issued.token;
      return { ...pub, text: issued.text };
    },

    /**
     * Verify and store a submission. The response is deliberately identical for verified and
     * quarantined runs (shadow-ban): attackers never learn which rule caught them.
     */
    async submit({ userId, ip, runId, nonce, entries }) {
      if (!userId) throw httpError(401, 'unauthenticated');
      if ((await limited(`sub:u:${userId}`, LIMITS.submitPerMinUser)) || (await limited(`sub:ip:${ip}`, LIMITS.submitPerMinIp))) throw httpError(429, 'rate limited');
      if (typeof runId !== 'string' || typeof nonce !== 'string') throw httpError(400, 'invalid submission');
      const token = await store.getToken(runId);
      if (!token || token.userId !== userId || token.nonce !== nonce) throw httpError(400, 'invalid submission');
      const fresh = await store.consumeToken(runId, now());
      const board = boardKeyOf(token.modeId, token.options);
      const history = await store.history(userId, board, 20);
      const v = await verifySubmission({ secret, token, entries, now: now(), nonceUsed: !fresh, history });
      if (v.verdict === 'rejected') throw httpError(400, 'invalid submission');
      const r = v.result;
      const run = {
        id: runId,
        userId,
        board,
        modeId: token.modeId,
        language: token.options.language || null,
        seed: token.seed,
        status: v.verdict,
        flags: v.reasons,
        netWpm: r ? r.netWpm : 0,
        grossWpm: r ? r.grossWpm : 0,
        rawAccuracy: r ? r.rawAccuracy : 0,
        finalAccuracy: r ? r.finalAccuracy : 0,
        consistency: r ? r.consistency : 0,
        score: r ? r.score : 0,
        durationMs: r ? r.elapsedMs : 0,
        chars: r ? r.typedChars : 0,
        createdAt: now(),
      };
      await store.saveRun(run, /** @type {Object[]} */ (entries));
      if (v.verdict === 'verified' && store.notify) await store.notify(board);
      const qualified = v.verdict === 'verified' || v.verdict === 'quarantined';
      const pub = r ? { netWpm: r.netWpm, grossWpm: r.grossWpm, rawAccuracy: r.rawAccuracy, finalAccuracy: r.finalAccuracy, consistency: r.consistency, score: r.score } : null;
      return { status: 'accepted', runId, qualified, result: pub };
    },
  };
}
