/**
 * Backend client shared by both front-ends. Zero dependencies (fetch only).
 *   supabase - Supabase Auth (anonymous sessions), Edge Functions and PostgREST RPCs
 *   local    - the zero-dependency dev server in tools/serve.mjs (same API surface)
 *   offline  - everything still works locally; ranked submission is unavailable
 * No secrets live here: only the public Supabase URL and anon key.
 * @module client/api
 */
import { createRealtime } from './realtime.js';

const AUTH_KEY = 'kf:auth:v1';
const DEVICE_KEY = 'kf:device:v1';

const safeGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k, v) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {{supabaseUrl?:string, supabaseAnonKey?:string}} [config]
 */
export function createApi(config = {}) {
  const url = (config.supabaseUrl || '').replace(/\/$/, '');
  const anon = config.supabaseAnonKey || '';
  let mode = 'offline';
  let session = null;
  try {
    session = JSON.parse(safeGet(AUTH_KEY) || 'null');
  } catch {
    session = null;
  }
  let realtime = null;

  const deviceId = () => {
    let id = safeGet(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
      safeSet(DEVICE_KEY, id);
    }
    return id;
  };

  async function json(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error || body.message || body.msg || res.statusText);
    return body;
  }

  async function signInAnonymously() {
    const res = await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ data: {} }) });
    const body = await json(res);
    session = { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: Date.now() + (body.expires_in || 3600) * 1000, user_id: body.user?.id };
    safeSet(AUTH_KEY, JSON.stringify(session));
  }

  async function refresh() {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    const body = await json(res);
    session = { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: Date.now() + (body.expires_in || 3600) * 1000, user_id: body.user?.id || session.user_id };
    safeSet(AUTH_KEY, JSON.stringify(session));
  }

  async function ensureSession() {
    if (mode !== 'supabase') return;
    if (!session) return signInAnonymously();
    if (Date.now() > session.expires_at - 60_000) {
      try {
        await refresh();
      } catch {
        await signInAnonymously();
      }
    }
  }

  async function call(path, { method = 'POST', body } = {}) {
    if (mode === 'offline') throw new ApiError(0, 'offline');
    if (mode === 'local') {
      const res = await fetch(`/api/${path}`, { method, headers: { 'content-type': 'application/json', 'x-kf-device': deviceId() }, body: body ? JSON.stringify(body) : undefined });
      return json(res);
    }
    await ensureSession();
    const [kind, name] = path.split(':');
    const target = kind === 'fn' ? `${url}/functions/v1/${name}` : `${url}/rest/v1/rpc/${name}`;
    const res = await fetch(target, {
      method: 'POST',
      headers: { apikey: anon, authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return json(res);
  }

  const route = (local, remote) => (mode === 'local' ? local : remote);

  return {
    ApiError,
    get mode() {
      return mode;
    },
    get userId() {
      return mode === 'local' ? deviceId() : session?.user_id || null;
    },
    /** Detect the backend. */
    async init() {
      if (url && anon) {
        mode = 'supabase';
        try {
          await ensureSession();
        } catch {
          mode = 'offline';
        }
      } else if (config.localApi === false) {
        mode = 'offline';
      } else {
        try {
          const res = await fetch('/api/health', { cache: 'no-store' });
          mode = res.ok && (await res.json()).ok ? 'local' : 'offline';
        } catch {
          mode = 'offline';
        }
      }
      realtime = createRealtime({ mode, supabaseUrl: url, supabaseAnonKey: anon, getToken: () => session?.access_token || null });
      return mode;
    },
    get online() {
      return mode !== 'offline';
    },
    /** Request a signed run token: {runId, seed, text, nonce, issuedAt, signature, modeId, options}. */
    runToken: (modeId, options, policy = 'free') => call(route('run-token', 'fn:run-token'), { body: { modeId, options, policy } }),
    /** Submit raw telemetry. The client never sends a score. */
    submitRun: ({ runId, nonce, entries }) => call(route('submit-run', 'fn:submit-run'), { body: { runId, nonce, entries } }),
    leaderboard: ({ board, period, cohort }) => call(route('leaderboard', 'rpc:get_leaderboard'), { body: { p_board: board, p_period: period, p_cohort: cohort || null } }),
    personal: () => call(route('personal', 'rpc:get_personal_board'), { body: {} }),
    setHandle: (handle) => call(route('set-handle', 'rpc:set_handle'), { body: { p_handle: handle } }),
    createCohort: (name) => call(route('create-cohort', 'rpc:create_cohort'), { body: { p_name: name } }),
    joinCohort: (code) => call(route('join-cohort', 'rpc:join_cohort'), { body: { p_code: code } }),
    myCohorts: () => call(route('my-cohorts', 'rpc:my_cohorts'), { body: {} }),
    coach: (payload) => call(route('ai-coach', 'fn:ai-coach'), { body: { stats: payload } }),
    deleteMyData: () => call(route('delete-me', 'rpc:delete_my_data'), { body: {} }),
    /** @param {string} name */
    channel(name) {
      return (realtime || createRealtime({ mode: 'offline' })).channel(name);
    },
    /** Forget the local session (used by "delete my data"). */
    signOut() {
      session = null;
      safeSet(AUTH_KEY, null);
    },
  };
}
