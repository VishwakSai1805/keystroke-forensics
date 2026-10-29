// POST /functions/v1/submit-run  { runId, nonce, entries }
// The client never sends a score. The server replays `entries` through the shared engine,
// recomputes every metric, runs the anti-cheat rules and stores the verdict.
// Verified and quarantined runs receive the same response (shadow-ban).
import { admin, runs } from '../_shared/service.js';
import { preflight, json, requireUser, clientIp, readBody, fail } from '../_shared/http.js';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { error: 'method not allowed' });
  try {
    const user = await requireUser(admin, req);
    const body = await readBody(req);
    const out = await runs.submit({ userId: user.id, ip: clientIp(req), runId: body.runId, nonce: body.nonce, entries: body.entries });
    return json(req, 200, out);
  } catch (e) {
    return fail(req, e);
  }
});
