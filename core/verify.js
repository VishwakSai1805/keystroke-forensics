/**
 * Server-side run verification (anti-cheat). Pure and runtime-neutral: uses only WebCrypto,
 * so the same code runs in Supabase Edge Functions (Deno), Node (local dev server, tests)
 * and is unit-testable. The client's own claimed score is never trusted: metrics are
 * recomputed by replaying the raw keystroke log through the shared engine.
 * @module core/verify
 */
import { replayRun } from './replay.js';
import { STATES } from './engine.js';
import { getMode, resolveOptions } from './modes/index.js';
import { generateText } from './textSource.js';
import { dailySeed, randomSeed, utcDay } from './prng.js';
import { mean, stdev, median, coefficientOfVariation, trimOutliers } from './metrics.js';

/** Tunable thresholds. Documented in THREAT_MODEL.md. */
export const RULES = Object.freeze({
  tokenTtlMs: 10 * 60 * 1000,
  minHumanIntervalMs: 15,
  maxFastRun: 6,
  minMedianIntervalMs: 25,
  minIntervalCvPct: 8,
  minDwellCvPct: 5,
  minSamplesForVariance: 30,
  maxMissingKeyupPct: 2,
  wallClockSlackMs: 1000,
  zScoreSpike: 3,
  minHistoryForZ: 5,
  maxEntries: 20000,
});

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('WebCrypto unavailable');
  return s;
};

/**
 * Canonical JSON (recursively sorted keys) so signatures are stable.
 * @param {unknown} v Value.
 * @returns {string}
 */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
    .join(',')}}`;
}

/** SHA-256 hex digest. @param {string} s @returns {Promise<string>} */
export async function sha256Hex(s) {
  return hex(await subtle().digest('SHA-256', enc.encode(s)));
}

async function hmacKey(secret) {
  return subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** HMAC-SHA256 hex. @param {string} secret @param {string} message @returns {Promise<string>} */
export async function hmacSign(secret, message) {
  return hex(await subtle().sign('HMAC', await hmacKey(secret), enc.encode(message)));
}

/** Constant-time HMAC verification via WebCrypto. */
export async function hmacVerify(secret, message, signatureHex) {
  if (typeof signatureHex !== 'string' || !/^[0-9a-f]{64}$/.test(signatureHex)) return false;
  const sig = new Uint8Array(signatureHex.match(/../g).map((h) => parseInt(h, 16)));
  return subtle().verify('HMAC', await hmacKey(secret), sig, enc.encode(message));
}

const SIGNED_FIELDS = ['runId', 'userId', 'modeId', 'options', 'policy', 'seed', 'textHash', 'nonce', 'issuedAt', 'expiresAt'];

/** The exact string covered by the token signature. */
export function tokenMessage(t) {
  return canonicalJson(Object.fromEntries(SIGNED_FIELDS.map((k) => [k, t[k]])));
}

const randomHex = (bytes) => hex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
const uuid = () => (globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : randomHex(16));

/**
 * Issue a signed run token. The server picks the seed, so text cannot be pre-generated.
 * @param {{secret:string, userId:string, modeId:string, options?:Object, policy?:'free'|'strict', now:number}} p
 * @returns {Promise<{token:Object, text:string}>}
 */
export async function issueRunToken({ secret, userId, modeId, options = {}, policy = 'free', now }) {
  const mode = getMode(modeId);
  if (!mode.scoreRules.ranked) throw new Error(`Mode ${modeId} is not ranked`);
  const opts = resolveOptions(modeId, options);
  let seed = randomSeed();
  if (modeId === 'daily') {
    opts.day = utcDay(now);
    seed = dailySeed(opts.day);
  }
  const { text } = generateText(modeId, opts, seed);
  const duration = mode.durationMs ? mode.durationMs(opts) : 0;
  const token = {
    runId: uuid(),
    userId,
    modeId,
    options: opts,
    policy: policy === 'strict' ? 'strict' : 'free',
    seed,
    textHash: await sha256Hex(text),
    nonce: randomHex(16),
    issuedAt: now,
    expiresAt: now + RULES.tokenTtlMs + duration,
  };
  token.signature = await hmacSign(secret, tokenMessage(token));
  return { token, text };
}

const KINDS = new Set(['key', 'ime', 'paste', 'blur']);

/**
 * Structural validation of an untrusted keystroke log.
 * @param {unknown} entries Candidate entries.
 * @returns {string|null} Error or null when well-formed.
 */
export function validateEntriesShape(entries) {
  if (!Array.isArray(entries)) return 'entries not an array';
  if (entries.length === 0) return 'empty log';
  if (entries.length > RULES.maxEntries) return 'log too large';
  for (const e of entries) {
    if (!e || typeof e !== 'object') return 'entry not an object';
    if (!KINDS.has(e.kind)) return 'bad kind';
    if (typeof e.key !== 'string' || e.key.length > 16) return 'bad key';
    if (typeof e.code !== 'string' || e.code.length > 32) return 'bad code';
    if (typeof e.tDown !== 'number' || !Number.isFinite(e.tDown)) return 'bad tDown';
    if (e.tUp !== null && e.tUp !== undefined && (typeof e.tUp !== 'number' || !Number.isFinite(e.tUp))) return 'bad tUp';
    if (typeof e.isTrusted !== 'boolean') return 'bad isTrusted';
  }
  return null;
}

/**
 * Timing / provenance heuristics over a raw log. Returns machine-readable reasons.
 * @param {Object[]} entries Entries (untrusted).
 * @returns {string[]}
 */
export function analyzeLogIntegrity(entries) {
  const reasons = new Set();
  const keys = entries.filter((e) => e.kind === 'key');
  if (entries.some((e) => e.isTrusted === false)) reasons.add('untrusted-event');
  if (entries.some((e) => e.kind === 'paste')) reasons.add('paste-detected');
  if (entries.some((e) => e.kind === 'ime')) reasons.add('unverifiable-input');
  for (let i = 1; i < keys.length; i++) if (keys[i].tDown < keys[i - 1].tDown) reasons.add('non-monotonic');
  if (keys.some((e) => e.tUp !== null && e.tUp !== undefined && e.tUp < e.tDown)) reasons.add('negative-dwell');

  const body = keys.slice(0, Math.max(0, keys.length - 2));
  const missing = body.filter((e) => e.tUp === null || e.tUp === undefined).length;
  if (missing > Math.max(2, (body.length * RULES.maxMissingKeyupPct) / 100)) reasons.add('missing-keyup');

  const iv = [];
  for (let i = 1; i < keys.length; i++) iv.push(keys[i].tDown - keys[i - 1].tDown);
  let run = 0;
  for (const d of iv) {
    run = d < RULES.minHumanIntervalMs ? run + 1 : 0;
    if (run >= RULES.maxFastRun) {
      reasons.add('superhuman-interval');
      break;
    }
  }
  if (iv.length >= 10 && median(iv) < RULES.minMedianIntervalMs) reasons.add('superhuman-interval');
  if (iv.length >= RULES.minSamplesForVariance && coefficientOfVariation(trimOutliers(iv)) < RULES.minIntervalCvPct) reasons.add('uniform-timing');

  const dwell = keys.filter((e) => e.tUp !== null && e.tUp !== undefined).map((e) => e.tUp - e.tDown);
  if (dwell.length >= RULES.minSamplesForVariance && coefficientOfVariation(dwell) < RULES.minDwellCvPct) reasons.add('uniform-dwell');
  return [...reasons];
}

/**
 * Statistical spike detection against the user's own verified history on the same board.
 * @param {number[]} history Previous scores.
 * @param {number} value New score.
 * @returns {{z:number, spike:boolean}}
 */
export function zScore(history, value) {
  if (history.length < RULES.minHistoryForZ) return { z: 0, spike: false };
  const m = mean(history);
  const sd = Math.max(stdev(history), m * 0.08, 2);
  const z = (value - m) / sd;
  return { z: Math.round(z * 100) / 100, spike: z > RULES.zScoreSpike };
}

/**
 * @typedef {Object} Verdict
 * @property {'verified'|'quarantined'|'unqualified'|'rejected'} verdict
 * @property {string[]} reasons Internal only. Never returned to the client.
 * @property {Object|null} result Server-recomputed metrics.
 */

/**
 * Verify a submission end to end.
 * @param {{secret:string, token:Object, entries:unknown, now:number, nonceUsed:boolean, history?:number[]}} p
 * @returns {Promise<Verdict>}
 */
export async function verifySubmission({ secret, token, entries, now, nonceUsed, history = [] }) {
  const reject = (r) => ({ verdict: 'rejected', reasons: [r], result: null });
  if (!token || typeof token !== 'object') return reject('no-token');
  if (!(await hmacVerify(secret, tokenMessage(token), token.signature))) return reject('bad-signature');
  if (now > token.expiresAt) return reject('expired');
  if (nonceUsed) return reject('replayed-nonce');
  let mode;
  try {
    mode = getMode(token.modeId);
  } catch {
    return reject('bad-mode');
  }
  const { text } = generateText(token.modeId, token.options, token.seed);
  if ((await sha256Hex(text)) !== token.textHash) return reject('seed-mismatch');
  const shapeError = validateEntriesShape(entries);
  if (shapeError) return reject(`malformed: ${shapeError}`);

  const reasons = analyzeLogIntegrity(/** @type {Object[]} */ (entries));
  const engine = replayRun({ modeId: token.modeId, options: token.options, policy: token.policy, seed: token.seed, entries: /** @type {Object[]} */ (entries) });
  const snap = engine.getSnapshot();
  if (snap.status !== STATES.COMPLETE && snap.status !== STATES.FAILED) {
    return { verdict: 'unqualified', reasons: [...reasons, 'incomplete'], result: null };
  }
  const result = snap.result;

  if (now - token.issuedAt < result.elapsedMs - RULES.wallClockSlackMs) reasons.push('wall-clock');

  // Client-supplied hints (expected/correct) must agree with the server's own replay.
  const server = engine.entries().filter((e) => e.kind === 'key');
  const client = /** @type {Object[]} */ (entries).filter((e) => e.kind === 'key' && (e.op === 'char' || e.op === 'reject' || e.op === 'back'));
  if (client.length !== server.length || client.some((c, i) => c.correct !== server[i].correct || c.op !== server[i].op)) reasons.push('hint-mismatch');

  const { spike, z } = zScore(history, result.score);
  if (spike) reasons.push(`wpm-spike:z=${z}`);

  if (reasons.length) return { verdict: 'quarantined', reasons, result };
  const rules = mode.scoreRules;
  if (result.typedChars < rules.minChars || result.finalAccuracy < rules.minAccuracy) return { verdict: 'unqualified', reasons: ['below-qualification'], result };
  return { verdict: 'verified', reasons: [], result };
}
