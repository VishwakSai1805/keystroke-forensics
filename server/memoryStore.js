/**
 * In-memory store with optional JSON-file persistence. Implements the RunStore contract
 * plus leaderboard / cohort / profile queries mirroring the Supabase SQL functions, so the
 * local dev server and tests exercise the exact same service code as production.
 * @module server/memoryStore
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PERIOD_MS = { daily: 86_400_000, weekly: 7 * 86_400_000, alltime: Infinity };

/**
 * @param {{file?:string}} [o]
 */
export function createMemoryStore(o = {}) {
  let data = { tokens: {}, runs: [], profiles: {}, cohorts: {}, members: [], buckets: {} };
  if (o.file) {
    try {
      data = { ...data, ...JSON.parse(readFileSync(o.file, 'utf8')) };
    } catch {
      /* fresh store */
    }
  }
  let timer = null;
  const persist = () => {
    if (!o.file) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      mkdirSync(dirname(o.file), { recursive: true });
      writeFileSync(o.file, JSON.stringify(data));
    }, 200);
  };
  const listeners = new Set();
  const handle = (uid) => (data.profiles[uid] && data.profiles[uid].handle) || `typist-${uid.slice(0, 6)}`;

  return {
    async hit(key, windowMs, now) {
      const b = (data.buckets[key] || []).filter((t) => t > now - windowMs);
      b.push(now);
      data.buckets[key] = b;
      return b.length;
    },
    async saveToken(token) {
      data.tokens[token.runId] = { ...token, consumedAt: null };
      persist();
    },
    async getToken(runId) {
      const t = data.tokens[runId];
      if (!t) return null;
      const { consumedAt: _c, ...token } = t;
      return token;
    },
    async consumeToken(runId, now) {
      const t = data.tokens[runId];
      if (!t || t.consumedAt) return false;
      t.consumedAt = now;
      persist();
      return true;
    },
    async history(userId, board, n) {
      return data.runs
        .filter((r) => r.userId === userId && r.board === board && r.status === 'verified')
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, n)
        .map((r) => r.score);
    },
    async saveRun(run) {
      data.runs.push(run);
      persist();
    },
    async notify(board) {
      for (const fn of listeners) fn(board);
    },
    onNotify(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Best verified score per user on a board within a period, optionally within a cohort. */
    async leaderboard({ board, period, cohort, userId, now }) {
      const since = now - (PERIOD_MS[period] ?? Infinity);
      let members = null;
      if (cohort) {
        const c = Object.values(data.cohorts).find((x) => x.code === cohort);
        if (!c) return [];
        members = new Set(data.members.filter((m) => m.cohortId === c.id).map((m) => m.userId));
      }
      const best = new Map();
      for (const r of data.runs) {
        if (r.board !== board || r.status !== 'verified' || r.createdAt < since) continue;
        if (members && !members.has(r.userId)) continue;
        const cur = best.get(r.userId);
        if (!cur || r.score > cur.score) best.set(r.userId, r);
      }
      return [...best.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map((r, i) => ({
          rank: i + 1,
          handle: handle(r.userId),
          score: r.score,
          net_wpm: r.netWpm,
          accuracy: r.finalAccuracy,
          consistency: r.consistency,
          created_at: new Date(r.createdAt).toISOString(),
          is_me: r.userId === userId,
        }));
    },
    /** Personal board: own bests per board plus a 30-day daily trend. Quarantined runs look accepted to their owner. */
    async personal({ userId, now }) {
      const mine = data.runs.filter((r) => r.userId === userId && (r.status === 'verified' || r.status === 'quarantined'));
      const bests = {};
      for (const r of mine) if (!bests[r.board] || r.score > bests[r.board].score) bests[r.board] = r;
      const trend = {};
      for (const r of mine) {
        if (r.createdAt < now - 30 * 86_400_000) continue;
        const day = new Date(r.createdAt).toISOString().slice(0, 10);
        trend[day] = Math.max(trend[day] || 0, r.netWpm);
      }
      return {
        bests: Object.values(bests).map((r) => ({ board: r.board, score: r.score, net_wpm: r.netWpm, accuracy: r.finalAccuracy, created_at: new Date(r.createdAt).toISOString() })),
        trend: Object.entries(trend)
          .sort()
          .map(([day, wpm]) => ({ day, net_wpm: wpm })),
      };
    },
    async setHandle(userId, h) {
      const clean = String(h || '')
        .trim()
        .slice(0, 24);
      if (!/^[A-Za-z0-9_.-]{3,24}$/.test(clean)) throw Object.assign(new Error('handle must be 3-24 letters, digits, _ . -'), { status: 400 });
      if (Object.entries(data.profiles).some(([uid, p]) => uid !== userId && p.handle === clean)) throw Object.assign(new Error('handle taken'), { status: 409 });
      data.profiles[userId] = { ...(data.profiles[userId] || {}), handle: clean };
      persist();
      return { handle: clean };
    },
    async createCohort(userId, name) {
      const clean = String(name || '')
        .trim()
        .slice(0, 40);
      if (clean.length < 2) throw Object.assign(new Error('name too short'), { status: 400 });
      const id = `c${Object.keys(data.cohorts).length + 1}`;
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      data.cohorts[id] = { id, name: clean, code, owner: userId };
      data.members.push({ cohortId: id, userId });
      persist();
      return { name: clean, code };
    },
    async joinCohort(userId, code) {
      const c = Object.values(data.cohorts).find((x) => x.code === String(code || '').toUpperCase());
      if (!c) throw Object.assign(new Error('unknown invite code'), { status: 404 });
      if (!data.members.some((m) => m.cohortId === c.id && m.userId === userId)) data.members.push({ cohortId: c.id, userId });
      persist();
      return { name: c.name, code: c.code };
    },
    async myCohorts(userId) {
      const ids = new Set(data.members.filter((m) => m.userId === userId).map((m) => m.cohortId));
      return Object.values(data.cohorts)
        .filter((c) => ids.has(c.id))
        .map((c) => ({ name: c.name, code: c.code }));
    },
    async deleteUser(userId) {
      data.runs = data.runs.filter((r) => r.userId !== userId);
      delete data.profiles[userId];
      data.members = data.members.filter((m) => m.userId !== userId);
      for (const [k, t] of Object.entries(data.tokens)) if (t.userId === userId) delete data.tokens[k];
      persist();
      return { deleted: true };
    },
    /** Test helper. */
    _data: () => data,
  };
}
