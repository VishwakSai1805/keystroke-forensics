// Zero-dependency local dev server.
//   - serves the repo root (so /vanilla imports /core and /client directly, no build step)
//   - implements the backend API with the SAME service code the Supabase Edge Functions use
//   - SSE relay for duels when Supabase is not configured
//   - sends the production security headers (CSP etc.)
// Usage: node tools/serve.mjs [--port 8080]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRunService } from '../server/runService.js';
import { createMemoryStore } from '../server/memoryStore.js';
import { createCoachService } from '../server/coachService.js';

const ROOT = resolve(process.cwd());
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > -1 ? process.argv[argPort + 1] : process.env.PORT || 8080);
const SECRET = process.env.RUN_TOKEN_SECRET || randomBytes(32).toString('hex');
const store = createMemoryStore({ file: process.env.KF_DEV_DB || join(ROOT, '.data', 'dev-db.json') });
const runs = createRunService({ store, secret: SECRET });

let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic();
  } catch {
    anthropic = null;
  }
}
const coach = createCoachService({ anthropic });

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

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'";

function securityHeaders(res, path) {
  const embeddable = path.endsWith('/embed.html');
  res.setHeader('Content-Security-Policy', `${CSP}; frame-ancestors ${embeddable ? '*' : "'none'"}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (!embeddable) res.setHeader('X-Frame-Options', 'DENY');
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readJson(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('payload too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}

// ---- SSE relay (duels, leaderboard pings) ----
const rooms = new Map();
function relaySubscribe(room, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(': connected\n\n');
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  res.on('close', () => {
    clearInterval(ping);
    rooms.get(room)?.delete(res);
  });
}
function relayPublish(room, msg) {
  for (const res of rooms.get(room) || []) res.write(`data: ${JSON.stringify(msg)}\n\n`);
}
store.onNotify((board) => relayPublish('leaderboard', { from: 'server', event: 'update', payload: { board } }));

async function api(req, res, path) {
  const userId = String(req.headers['x-kf-device'] || '').slice(0, 64) || null;
  const ip = req.socket.remoteAddress || 'local';
  const now = Date.now();
  const relay = path.match(/^\/api\/relay\/([\w:.-]{1,64})$/);
  if (relay) {
    if (req.method === 'GET') return relaySubscribe(relay[1], res);
    const body = await readJson(req, 10_000);
    relayPublish(relay[1], body);
    return send(res, 200, { ok: true });
  }
  if (path === '/api/health') return send(res, 200, { ok: true, backend: 'local-dev' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  const body = await readJson(req);
  switch (path) {
    case '/api/run-token':
      return send(res, 200, await runs.issue({ userId, ip, modeId: body.modeId, options: body.options || {}, policy: body.policy }));
    case '/api/submit-run':
      return send(res, 200, await runs.submit({ userId, ip, runId: body.runId, nonce: body.nonce, entries: body.entries }));
    case '/api/leaderboard':
      return send(res, 200, await store.leaderboard({ board: body.p_board, period: body.p_period, cohort: body.p_cohort, userId, now }));
    case '/api/personal':
      return send(res, 200, await store.personal({ userId, now }));
    case '/api/set-handle':
      return send(res, 200, await store.setHandle(userId, body.p_handle));
    case '/api/create-cohort':
      return send(res, 200, await store.createCohort(userId, body.p_name));
    case '/api/join-cohort':
      return send(res, 200, await store.joinCohort(userId, body.p_code));
    case '/api/my-cohorts':
      return send(res, 200, await store.myCohorts(userId));
    case '/api/delete-me':
      return send(res, 200, await store.deleteUser(userId));
    case '/api/ai-coach':
      return send(res, 200, await coach.plan(body.stats));
    default:
      return send(res, 404, { error: 'not found' });
  }
}

async function serveStatic(req, res, path) {
  if (path === '/' || path === '') {
    res.writeHead(302, { location: '/vanilla/' });
    return res.end();
  }
  let file = normalize(join(ROOT, decodeURIComponent(path)));
  if (!file.startsWith(ROOT) || /[\\/](\.|node_modules[\\/]\.)/.test(file.slice(ROOT.length))) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const st = await stat(file);
    if (st.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    securityHeaders(res, file.replace(/\\/g, '/'));
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) await api(req, res, path);
    else await serveStatic(req, res, path);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
  }
}).listen(PORT, () => {
  console.log(`Keystroke Forensics dev server: http://localhost:${PORT}/vanilla/`);
  console.log(`  backend: local (same verification code as the Supabase Edge Functions)${anthropic ? ' + Claude coach' : ''}`);
});
