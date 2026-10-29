// POST /functions/v1/ai-coach  { stats }  (aggregated statistics only; schema-validated)
// Uses Claude when ANTHROPIC_API_KEY is set; otherwise returns the deterministic offline plan.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { admin, store } from '../_shared/service.js';
import { createCoachService } from '../_shared/server/coachService.js';
import { preflight, json, requireUser, readBody, fail } from '../_shared/http.js';

const key = Deno.env.get('ANTHROPIC_API_KEY');
const coach = createCoachService({ anthropic: key ? new Anthropic({ apiKey: key }) : null });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, 405, { error: 'method not allowed' });
  try {
    const user = await requireUser(admin, req);
    if ((await store.hit(`coach:${user.id}`, 60_000)) > 5) return json(req, 429, { error: 'rate limited' });
    const body = await readBody(req, 20_000);
    return json(req, 200, await coach.plan(body.stats));
  } catch (e) {
    return fail(req, e);
  }
});
