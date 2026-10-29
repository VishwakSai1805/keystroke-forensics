/**
 * AI coach service. Receives only aggregated, schema-validated statistics (never raw
 * keystrokes or identity), asks Claude for a structured practice plan, validates the reply,
 * and falls back to the deterministic offline plan on any failure.
 * The Anthropic client is injected so Node (dev server) and Deno (Edge Function) can each
 * pass their own `@anthropic-ai/sdk` import.
 * @module server/coachService
 */
import { validateCoachPayload, COACH_SYSTEM_PROMPT, COACH_PLAN_SCHEMA, sanitizePlan, offlinePlan } from '../core/coach.js';

export const COACH_MODEL = 'claude-opus-5-5';

/**
 * @param {{anthropic:any|null}} deps Anthropic SDK client (null when no API key is configured).
 */
export function createCoachService({ anthropic }) {
  return {
    /**
     * @param {unknown} stats Candidate payload from the client.
     * @returns {Promise<{source:'claude'|'offline', summary:string, drills:Object[], tips:string[]}>}
     */
    async plan(stats) {
      const v = validateCoachPayload(stats);
      if (!v.ok) {
        const err = new Error(`invalid stats: ${v.error}`);
        err.status = 400;
        throw err;
      }
      if (!anthropic) return offlinePlan(v.value);
      try {
        const response = await anthropic.beta.messages.create({
          model: COACH_MODEL,
          max_tokens: 4000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: COACH_PLAN_SCHEMA } },
          system: COACH_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `Typing statistics (JSON):\n${JSON.stringify(v.value)}` }],
        });
        if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return offlinePlan(v.value);
        const textBlock = response.content.find((b) => b.type === 'text');
        const plan = sanitizePlan(textBlock ? JSON.parse(textBlock.text) : null);
        return plan ? { source: 'claude', ...plan } : offlinePlan(v.value);
      } catch {
        return offlinePlan(v.value);
      }
    },
  };
}
