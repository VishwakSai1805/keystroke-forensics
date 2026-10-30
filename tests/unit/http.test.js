import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend, createStatic, originAllowed } from '../../server/http.js';
import { issueSession, verifySession } from '../../server/session.js';
import { createMemoryStore } from '../../server/memoryStore.js';
import { createCoachService } from '../../server/coachService.js';

const SECRET = 'http-test-secret-0123456789';
let server;
let base;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'kf-static-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>t</title>');
  const backend = createBackend({ store: createMemoryStore(), secret: SECRET, coach: createCoachService({ anthropic: null }), allowedOrigins: ['https://*.vercel.app'] });
  const serveStatic = createStatic({ root });
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (!(await backend.handle(req, res, path))) await serveStatic(req, res, path);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const post = (path, body, token, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body || {}) });

describe('sessions', () => {
  it('round-trips and rejects tampering or expiry', async () => {
    const now = 1_800_000_000_000;
    const s = await issueSession(SECRET, now);
    expect(await verifySession(SECRET, s.token, now)).toBe(s.userId);
    expect(await verifySession('another-secret-xxxxxxxx', s.token, now)).toBe(null);
    const [id, iat, sig] = s.token.split('.');
    expect(await verifySession(SECRET, `${id.replace(/^./, id[0] === 'a' ? 'b' : 'a')}.${iat}.${sig}`, now)).toBe(null);
    expect(await verifySession(SECRET, s.token, now + 400 * 86_400_000)).toBe(null);
    expect(await verifySession(SECRET, 'garbage', now)).toBe(null);
  });
});

describe('HTTP API', () => {
  it('health is public; everything else needs a session', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await post('/api/run-token', { modeId: 'words' })).status).toBe(401);
    expect((await post('/api/run-token', { modeId: 'words' }, 'forged.token')).status).toBe(401);
  });

  it('issues a session and uses it end to end', async () => {
    const s = await (await post('/api/session')).json();
    const tok = await (await post('/api/run-token', { modeId: 'words', options: { count: 10 } }, s.token)).json();
    expect(tok.text.length).toBeGreaterThan(10);
    expect(tok).not.toHaveProperty('userId');
    const board = await (await post('/api/leaderboard', { p_board: 'words:10', p_period: 'daily' }, s.token)).json();
    expect(Array.isArray(board)).toBe(true);
  });

  it("a session cannot submit another session's token", async () => {
    const a = await (await post('/api/session')).json();
    const b = await (await post('/api/session')).json();
    const tok = await (await post('/api/run-token', { modeId: 'words', options: { count: 10 } }, a.token)).json();
    const res = await post('/api/submit-run', { runId: tok.runId, nonce: tok.nonce, entries: [] }, b.token);
    expect(res.status).toBe(400);
  });

  it('CORS only for allow-listed origins', async () => {
    const ok = await fetch(`${base}/api/health`, { headers: { origin: 'https://kf-abc123.vercel.app' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://kf-abc123.vercel.app');
    const bad = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBe(null);
    expect(originAllowed('https://a.vercel.app.evil.test', ['https://*.vercel.app'])).toBe(false);
  });

  it('rejects oversized bodies and unknown routes without leaking internals', async () => {
    const s = await (await post('/api/session')).json();
    const big = await post('/api/submit-run', { entries: 'x'.repeat(2_100_000) }, s.token);
    expect(big.status).toBe(413);
    const missing = await post('/api/nope', {}, s.token);
    expect(missing.status).toBe(404);
  });

  it('static files carry security headers and block traversal', async () => {
    const res = await fetch(`${base}/`);
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    const trav = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(trav.status);
  });
});
