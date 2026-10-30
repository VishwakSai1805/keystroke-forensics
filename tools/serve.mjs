// Zero-dependency local dev server.
//   - serves the repo root (so /vanilla imports /core and /client directly, no build step)
//   - runs the SAME API code as production (server/http.js + runService) with an in-memory store
//   - SSE relay for duels and leaderboard pings
//   - sends the production security headers (CSP etc.)
// Usage: node tools/serve.mjs [--port 8080]
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createMemoryStore } from '../server/memoryStore.js';
import { createCoachService } from '../server/coachService.js';
import { createBackend, createStatic, loadCoachProviders } from '../server/http.js';

const ROOT = resolve(process.cwd());
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > -1 ? process.argv[argPort + 1] : process.env.PORT || 8080);
const secret = process.env.RUN_TOKEN_SECRET || randomBytes(32).toString('hex');
const store = createMemoryStore({ file: process.env.KF_DEV_DB || join(ROOT, '.data', 'dev-db.json') });
const coach = createCoachService(await loadCoachProviders());
const backend = createBackend({ store, secret, coach, allowedOrigins: ['http://localhost:5173', 'http://localhost:5174'], label: 'local-dev' });
const serveStatic = createStatic({ root: ROOT, rootRedirect: '/vanilla/' });

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (!(await backend.handle(req, res, path))) await serveStatic(req, res, path);
}).listen(PORT, () => {
  console.log(`Keystroke Forensics dev server: http://localhost:${PORT}/vanilla/`);
  console.log(`  backend: in-memory store, same code as production (coach: ${coach.providers.join(' -> ') || 'offline'})`);
});
