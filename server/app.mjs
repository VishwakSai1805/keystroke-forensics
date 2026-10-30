// Production server (Render web service): serves the built front-ends from dist/ and the API
// under /api from one origin. Storage: Render Postgres via DATABASE_URL.
//   Required env: DATABASE_URL, RUN_TOKEN_SECRET (>= 16 chars)
//   Optional env: ANTHROPIC_API_KEY or GEMINI_API_KEY (AI coach), ALLOWED_ORIGINS (comma list, e.g. the
//                 Vercel front-end: https://keystroke-forensics.vercel.app,https://*.vercel.app)
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import pg from 'pg';
import { createPgStore } from './pgStore.js';
import { createMemoryStore } from './memoryStore.js';
import { createCoachService } from './coachService.js';
import { createBackend, createStatic, loadCoachProviders } from './http.js';

const PORT = Number(process.env.PORT || 10000);
const secret = process.env.RUN_TOKEN_SECRET;
if (!secret || secret.length < 16) {
  console.error('RUN_TOKEN_SECRET (>= 16 chars) is required');
  process.exit(1);
}

let store;
if (process.env.DATABASE_URL) {
  const local = /localhost|127\.0\.0\.1|@[a-z0-9-]+(:\d+)?\//i.test(process.env.DATABASE_URL);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX || 5), ssl: local ? false : { rejectUnauthorized: false } });
  // An idle client dropped by the database must not crash the process; the pool reconnects.
  pool.on('error', (err) => console.error('postgres pool error:', err.message));
  store = await createPgStore({ query: (text, params) => pool.query(text, params) });
  console.log('storage: postgres');
} else {
  store = createMemoryStore();
  console.warn('storage: in-memory (DATABASE_URL not set) - data is lost on restart');
}

const coach = createCoachService(await loadCoachProviders());
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const backend = createBackend({ store, secret, coach, allowedOrigins, trustProxy: true, label: 'render' });
const serveStatic = createStatic({ root: resolve(process.env.STATIC_ROOT || 'dist'), immutable: /^\/(react\/)?assets\//, hsts: true });

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (!(await backend.handle(req, res, path))) await serveStatic(req, res, path);
}).listen(PORT, () => console.log(`Keystroke Forensics listening on :${PORT} (coach: ${coach.providers.join(' -> ') || 'offline'})`));
