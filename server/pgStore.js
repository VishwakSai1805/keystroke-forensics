/**
 * Postgres implementation of the RunStore contract plus leaderboard / cohort / profile
 * queries. Mirrors server/memoryStore.js exactly (the same unit tests run against both).
 * Takes any `query(text, params) -> {rows}` function, so it works with node-postgres in
 * production and PGlite (in-process Postgres) in tests.
 * Every method that reads or writes user data is scoped to the authenticated user id.
 * @module server/pgStore
 */
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const PERIOD_MS = { daily: 86_400_000, weekly: 7 * 86_400_000 };
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const num = (x) => (x === null || x === undefined ? 0 : Number(x));

/**
 * @param {{query:(text:string, params?:unknown[])=>Promise<{rows:Object[]}>, exec?:(sql:string)=>Promise<unknown>}} db
 */
export async function createPgStore(db) {
  if (db.exec) await db.exec(SCHEMA);
  else await db.query(SCHEMA);
  const q = async (text, params) => (await db.query(text, params)).rows;
  const listeners = new Set();
  const ensureUser = (userId) => q('insert into users (id) values ($1) on conflict do nothing', [userId]);
  const handleSql = "coalesce(p.handle, 'typist-' || left(r.user_id, 6))";

  return {
    ensureUser,
    async hit(key, windowMs, now) {
      await q('delete from rate_events where bucket = $1 and at < $2', [key, now - windowMs * 5]);
      await q('insert into rate_events (bucket, at) values ($1, $2)', [key, now]);
      const [row] = await q('select count(*)::int as n from rate_events where bucket = $1 and at > $2', [key, now - windowMs]);
      return row.n;
    },
    async saveToken(t) {
      await ensureUser(t.userId);
      await q(
        `insert into run_tokens (run_id, user_id, mode_id, options, policy, seed, text_hash, nonce, signature, issued_at, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [t.runId, t.userId, t.modeId, JSON.stringify(t.options), t.policy, t.seed, t.textHash, t.nonce, t.signature, t.issuedAt, t.expiresAt],
      );
    },
    async getToken(runId) {
      if (!/^[0-9a-f-]{36}$/i.test(String(runId))) return null;
      const [r] = await q('select * from run_tokens where run_id = $1', [runId]);
      if (!r) return null;
      return {
        runId: r.run_id,
        userId: r.user_id,
        modeId: r.mode_id,
        options: typeof r.options === 'string' ? JSON.parse(r.options) : r.options,
        policy: r.policy,
        seed: num(r.seed),
        textHash: r.text_hash,
        nonce: r.nonce,
        signature: r.signature,
        issuedAt: num(r.issued_at),
        expiresAt: num(r.expires_at),
      };
    },
    /** Atomic single-use consumption (replay protection). */
    async consumeToken(runId, now) {
      const rows = await q('update run_tokens set consumed_at = $2 where run_id = $1 and consumed_at is null returning run_id', [runId, now]);
      return rows.length === 1;
    },
    async history(userId, board, n) {
      const rows = await q("select score from runs where user_id = $1 and board_key = $2 and status = 'verified' order by created_at desc limit $3", [userId, board, n]);
      return rows.map((r) => num(r.score));
    },
    /** Run and its raw log are written in one statement (atomic). */
    async saveRun(run, entries) {
      await ensureUser(run.userId);
      await q(
        `with r as (
           insert into runs (id, user_id, board_key, mode_id, language, seed, net_wpm, gross_wpm, raw_accuracy, final_accuracy, consistency, score, duration_ms, chars, status, flags, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id)
         insert into run_logs (run_id, entries) select id, $18 from r`,
        [
          run.id,
          run.userId,
          run.board,
          run.modeId,
          run.language,
          run.seed,
          run.netWpm,
          run.grossWpm,
          run.rawAccuracy,
          run.finalAccuracy,
          run.consistency,
          run.score,
          Math.round(run.durationMs),
          run.chars,
          run.status,
          run.flags,
          run.createdAt,
          JSON.stringify(entries ?? []),
        ],
      );
    },
    async notify(board) {
      for (const fn of listeners) fn(board);
    },
    onNotify(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Best verified score per user on a board within a period, optionally within a cohort the caller belongs to. */
    async leaderboard({ board, period, cohort, userId, now }) {
      const since = PERIOD_MS[period] ? now - PERIOD_MS[period] : 0;
      const rows = await q(
        `with scoped as (
           select r.* from runs r
           where r.board_key = $1 and r.status = 'verified' and r.created_at >= $2
             and ($3::text is null or exists (
               select 1 from cohort_members m join cohorts c on c.id = m.cohort_id
               where c.invite_code = $3 and m.user_id = r.user_id
                 and exists (select 1 from cohort_members me where me.cohort_id = c.id and me.user_id = $4)))
         ), best as (
           select distinct on (user_id) * from scoped order by user_id, score desc, created_at asc
         )
         select r.user_id, ${handleSql} as handle, r.score, r.net_wpm, r.final_accuracy, r.consistency, r.created_at
         from best r left join profiles p on p.user_id = r.user_id
         order by r.score desc, r.created_at asc limit 50`,
        [board, since, cohort || null, userId],
      );
      return rows.map((r, i) => ({
        rank: i + 1,
        handle: r.handle,
        score: num(r.score),
        net_wpm: num(r.net_wpm),
        accuracy: num(r.final_accuracy),
        consistency: num(r.consistency),
        created_at: new Date(num(r.created_at)).toISOString(),
        is_me: r.user_id === userId,
      }));
    },
    /** Own bests and 30-day trend. Quarantined runs look accepted to their owner (shadow-ban). */
    async personal({ userId, now }) {
      const bests = await q(
        `select distinct on (board_key) board_key, score, net_wpm, final_accuracy, created_at
         from runs where user_id = $1 and status in ('verified','quarantined') order by board_key, score desc`,
        [userId],
      );
      const trend = await q(
        `select to_char(to_timestamp(created_at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day, max(net_wpm) as net_wpm
         from runs where user_id = $1 and status in ('verified','quarantined') and created_at > $2 group by 1 order by 1`,
        [userId, now - 30 * 86_400_000],
      );
      return {
        bests: bests.map((b) => ({ board: b.board_key, score: num(b.score), net_wpm: num(b.net_wpm), accuracy: num(b.final_accuracy), created_at: new Date(num(b.created_at)).toISOString() })),
        trend: trend.map((t) => ({ day: t.day, net_wpm: num(t.net_wpm) })),
      };
    },
    async setHandle(userId, h) {
      const clean = String(h || '').trim();
      if (!/^[A-Za-z0-9_.-]{3,24}$/.test(clean)) throw httpErr(400, 'handle must be 3-24 letters, digits, _ . -');
      await ensureUser(userId);
      try {
        await q('insert into profiles (user_id, handle) values ($1, $2) on conflict (user_id) do update set handle = excluded.handle', [userId, clean]);
      } catch (e) {
        if (String(e.code) === '23505' || /unique/i.test(e.message)) throw httpErr(409, 'handle taken');
        throw e;
      }
      return { handle: clean };
    },
    async createCohort(userId, name) {
      const clean = String(name || '')
        .trim()
        .slice(0, 40);
      if (clean.length < 2) throw httpErr(400, 'name too short');
      await ensureUser(userId);
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (let attempt = 0; attempt < 10; attempt++) {
        let code = '';
        for (let i = 0; i < 6; i++) code += alphabet[randomInt(alphabet.length)];
        const rows = await q('insert into cohorts (name, invite_code, owner_id) values ($1, $2, $3) on conflict (invite_code) do nothing returning id', [clean, code, userId]);
        if (rows.length) {
          await q('insert into cohort_members (cohort_id, user_id) values ($1, $2)', [rows[0].id, userId]);
          return { name: clean, code };
        }
      }
      throw httpErr(500, 'could not allocate invite code');
    },
    async joinCohort(userId, code) {
      const [c] = await q('select id, name, invite_code from cohorts where invite_code = $1', [String(code || '').toUpperCase()]);
      if (!c) throw httpErr(404, 'unknown invite code');
      await ensureUser(userId);
      await q('insert into cohort_members (cohort_id, user_id) values ($1, $2) on conflict do nothing', [c.id, userId]);
      return { name: c.name, code: c.invite_code };
    },
    async myCohorts(userId) {
      const rows = await q('select c.name, c.invite_code from cohorts c join cohort_members m on m.cohort_id = c.id where m.user_id = $1 order by c.name', [userId]);
      return rows.map((r) => ({ name: r.name, code: r.invite_code }));
    },
    /** Right to erasure: cascades remove runs, logs, tokens, profile, memberships and owned cohorts. */
    async deleteUser(userId) {
      await q('delete from users where id = $1', [userId]);
      return { deleted: true };
    },
  };
}
