/**
 * AI coach service. Receives only aggregated, schema-validated statistics (never raw
 * keystrokes or identity), asks an LLM for a structured practice plan, validates the reply,
 * and falls back to the deterministic offline plan on any failure.
 *
 * Two providers, tried in order (whichever is configured):
 *   1. Claude  - Anthropic SDK client, injected so Node and Deno can each supply their own.
 *   2. Gemini  - Google's Interactions endpoint over plain fetch (no extra dependency).
 * With neither configured, the offline plan is used. The offline plan is also the fallback
 * whenever a provider errors, times out or returns something that fails validation, so the
 * endpoint never fails because of the LLM.
 * @module server/coachService
 */
import { validateCoachPayload, COACH_SYSTEM_PROMPT, COACH_PLAN_SCHEMA, sanitizePlan, offlinePlan } from '../core/coach.js';

export const COACH_MODEL = 'claude-opus-5-5';
export const GEMINI_COACH_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const TIMEOUT_MS = 20_000;

/**
 * Extract the model's text from an Interactions response. Defensive: the text may sit on a
 * `model_output` step directly or inside its `content` blocks.
 * @param {Object} body Parsed response body.
 * @returns {string}
 */
export function geminiOutputText(body) {
  const parts = [];
  for (const step of (body && body.steps) || []) {
    if (step.type && step.type !== 'model_output') continue;
    if (typeof step.text === 'string') parts.push(step.text);
    for (const block of step.content || []) if (typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('');
}

/**
 * @param {{anthropic?:Object|null, gemini?:{apiKey:string, model?:string}|null, fetch?:Function}} deps
 */
export function createCoachService({ anthropic = null, gemini = null, fetch: fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  // A blank key is the same as no provider, so `providers` and `plan` never disagree.
  if (!gemini || !gemini.apiKey) gemini = null;

  async function viaClaude(stats) {
    const response = await anthropic.beta.messages.create({
      model: COACH_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: COACH_PLAN_SCHEMA } },
      system: COACH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Typing statistics (JSON):\n${JSON.stringify(stats)}` }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const textBlock = response.content.find((b) => b.type === 'text');
    return sanitizePlan(textBlock ? JSON.parse(textBlock.text) : null);
  }

  async function viaGemini(stats) {
    const res = await doFetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': gemini.apiKey, 'content-type': 'application/json' },
      // The Interactions endpoint takes one input string, so the instructions are prepended.
      body: JSON.stringify({
        model: gemini.model || GEMINI_COACH_MODEL,
        input: `${COACH_SYSTEM_PROMPT}\n\nTyping statistics (JSON):\n${JSON.stringify(stats)}`,
        response_format: { type: 'text', mime_type: 'application/json', schema: COACH_PLAN_SCHEMA },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (body.status && body.status !== 'completed') return null;
    const text = geminiOutputText(body);
    return text ? sanitizePlan(JSON.parse(text)) : null;
  }

  return {
    /** Which providers are configured, in the order they are tried. */
    get providers() {
      return [anthropic && 'claude', gemini && 'gemini'].filter(Boolean);
    },
    /**
     * @param {unknown} stats Candidate payload from the client.
     * @returns {Promise<{source:'claude'|'gemini'|'offline', summary:string, drills:Object[], tips:string[]}>}
     */
    async plan(stats) {
      const v = validateCoachPayload(stats);
      if (!v.ok) {
        const err = new Error(`invalid stats: ${v.error}`);
        err.status = 400;
        throw err;
      }
      for (const [source, call] of [
        ['claude', anthropic && viaClaude],
        ['gemini', gemini && viaGemini],
      ]) {
        if (!call) continue;
        try {
          const plan = await call(v.value);
          if (plan) return { source, ...plan };
        } catch {
          /* fall through to the next provider, then to the offline plan */
        }
      }
      return offlinePlan(v.value);
    },
  };
}
