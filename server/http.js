/**
 * Zero-dependency HTTP layer shared by the dev server (tools/serve.mjs) and the production
 * server (server/app.mjs, deployed on Render): JSON API, signed anonymous sessions, CORS
 * allow-list, SSE relay for duels and leaderboard pings, static files with security headers.
 * @module server/http
 */
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRunService } from './runService.js';
import { issueSession, verifySession } from './session.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.onrender.com; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";

/** Production security headers (mirrors vercel.json). */
export function securityHeaders(res, path, { hsts = false } = {}) {
  const embeddable = path.endsWith('/embed.html');
  res.setHeader('Content-Security-Policy', `${CSP}; frame-ancestors ${embeddable ? '*' : "'none'"}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (!embeddable) res.setHeader('X-Frame-Options', 'DENY');
  if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}

const httpErr = (status, message) => Object.assign(new Error(message), { status });

async function readJson(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpErr(413, 'payload too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpErr(400, 'bad json');
  }
}

/** Origin allow-list: exact origins or `https://*.example.app` wildcards. */
export function originAllowed(origin, list) {
  if (!origin) return false;
  return list.some((p) => (p.includes('*') ? new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`, 'i').test(origin) : p === origin));
}

/**
 * Build the API handler.
 * @param {{store:Object, secret:string, coach:Object, allowedOrigins?:string[], trustProxy?:boolean, label?:string, now?:()=>number}} o
 */
export function createBackend(o) {
  const now = o.now || (() => Date.now());
  const runs = createRunService({ store: o.store, secret: o.secret, now });
  const allowed = o.allowedOrigins || [];
  const rooms = new Map();

  const ipOf = (req) =>
    (o.trustProxy &&
      String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim()) ||
    req.socket.remoteAddress ||
    'unknown';

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && originAllowed(origin, allowed)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  }
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };

  function relaySubscribe(room, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    res.on('close', () => {
      clearInterval(ping);
      rooms.get(room)?.delete(res);
      if (rooms.get(room)?.size === 0) rooms.delete(room);
    });
  }
  const publish = (room, msg) => {
    for (const res of rooms.get(room) || []) res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };
  if (o.store.onNotify) o.store.onNotify((board) => publish('leaderboard', { from: 'server', event: 'update', payload: { board } }));

  async function userOf(req) {
    const auth = String(req.headers.authorization || '');
    const id = await verifySession(o.secret, auth.startsWith('Bearer ') ? auth.slice(7) : null, now());
    if (!id) throw httpErr(401, 'unauthenticated');
    return id;
  }

  /** @returns {Promise<boolean>} true when the request was an API request. */
  async function handle(req, res, path) {
    if (!path.startsWith('/api/')) return false;
    cors(req, res);
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return true;
      }
      const ip = ipOf(req);
      const relay = path.match(/^\/api\/relay\/([\w:.-]{1,64})$/);
      if (relay && req.method === 'GET') {
        relaySubscribe(relay[1], res);
        return true;
      }
      if (path === '/api/health') {
        send(res, 200, { ok: true, backend: o.label || 'node' });
        return true;
      }
      if (req.method !== 'POST') throw httpErr(405, 'method not allowed');
      if (path === '/api/session') {
        if ((await o.store.hit(`sess:ip:${ip}`, 3_600_000, now())) > 30) throw httpErr(429, 'rate limited');
        const s = await issueSession(o.secret, now());
        if (o.store.ensureUser) await o.store.ensureUser(s.userId);
        send(res, 200, s);
        return true;
      }
      const userId = await userOf(req);
      if (relay) {
        if ((await o.store.hit(`relay:${userId}`, 60_000, now())) > 1200) throw httpErr(429, 'rate limited');
        publish(relay[1], await readJson(req, 10_000));
        send(res, 200, { ok: true });
        return true;
      }
      const body = await readJson(req, 2_000_000);
      const t = now();
      const s = o.store;
      let out;
      switch (path) {
        case '/api/run-token':
          out = await runs.issue({ userId, ip, modeId: String(body.modeId || ''), options: body.options || {}, policy: body.policy });
          break;
        case '/api/submit-run':
          out = await runs.submit({ userId, ip, runId: body.runId, nonce: body.nonce, entries: body.entries });
          break;
        case '/api/leaderboard':
          out = await s.leaderboard({ board: String(body.p_board || ''), period: body.p_period, cohort: body.p_cohort || null, userId, now: t });
          break;
        case '/api/personal':
          out = await s.personal({ userId, now: t });
          break;
        case '/api/set-handle':
          out = await s.setHandle(userId, body.p_handle);
          break;
        case '/api/create-cohort':
          out = await s.createCohort(userId, body.p_name);
          break;
        case '/api/join-cohort':
          out = await s.joinCohort(userId, body.p_code);
          break;
        case '/api/my-cohorts':
          out = await s.myCohorts(userId);
          break;
        case '/api/delete-me':
          out = await s.deleteUser(userId);
          break;
        case '/api/ai-coach':
          if ((await s.hit(`coach:${userId}`, 60_000, t)) > 5) throw httpErr(429, 'rate limited');
          out = await o.coach.plan(body.stats);
          break;
        default:
          throw httpErr(404, 'not found');
      }
      send(res, 200, out);
    } catch (e) {
      // An unread request body (e.g. 413) would wedge a keep-alive socket: close it instead.
      if (!req.readableEnded) res.setHeader('connection', 'close');
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
      if (!req.readableEnded) res.on('finish', () => req.destroy());
      if (!e.status) console.error(e);
    }
    return true;
  }

  return { handle, runs };
}

/**
 * Static file server with traversal protection and security headers.
 * @param {{root:string, rootRedirect?:string, immutable?:RegExp, hsts?:boolean}} o
 */
export function createStatic(o) {
  return async function serveStatic(req, res, path) {
    if (o.rootRedirect && (path === '/' || path === '')) {
      res.writeHead(302, { location: o.rootRedirect });
      res.end();
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    let file = normalize(join(o.root, decoded));
    if (!file.startsWith(o.root) || /[\\/]\./.test(file.slice(o.root.length))) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      securityHeaders(res, file.replace(/\\/g, '/'), { hsts: o.hsts });
      const cache = o.immutable && o.immutable.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': cache });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  };
}

/** Optional Claude client for the coach (only when ANTHROPIC_API_KEY is set). */
export async function loadAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic();
  } catch {
    return null;
  }
}
