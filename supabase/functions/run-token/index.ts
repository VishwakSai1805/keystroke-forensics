// POST /functions/v1/run-token  { modeId, options, policy }
// -> { runId, seed, text, nonce, issuedAt, expiresAt, signature, modeId, options, policy }
import { admin, runs } from '../_shared/service.js';
import { preflight, json, requireUser, clientIp, readBody, fail } from '../_shared/http.js';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { error: 'method not allowed' });
  try {
    const user = await requireUser(admin, req);
    const body = await readBody(req, 10_000);
    const out = await runs.issue({ userId: user.id, ip: clientIp(req), modeId: String(body.modeId || ''), options: body.options || {}, policy: body.policy });
    return json(req, 200, out);
  } catch (e) {
    return fail(req, e);
  }
});
