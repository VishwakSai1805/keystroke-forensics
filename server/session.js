/**
 * Anonymous sessions for the self-hosted backend: the server mints a random user id and an
 * HMAC-signed bearer token (`<userId>.<issuedAt>.<sig>`). The client can't choose or forge
 * its identity, which is what makes per-user history, rate limits and token binding hold.
 * @module server/session
 */
import { randomUUID } from 'node:crypto';
import { hmacSign, hmacVerify } from '../core/verify.js';

export const SESSION_TTL_MS = 365 * 86_400_000;
const msg = (userId, iat) => `session:${userId}.${iat}`;

/**
 * Mint a new anonymous session.
 * @param {string} secret Server secret.
 * @param {number} now Epoch ms.
 * @returns {Promise<{userId:string, token:string, expiresAt:number}>}
 */
export async function issueSession(secret, now) {
  const userId = randomUUID();
  const sig = await hmacSign(secret, msg(userId, now));
  return { userId, token: `${userId}.${now}.${sig}`, expiresAt: now + SESSION_TTL_MS };
}

/**
 * Verify a bearer token; returns the user id or null.
 * @param {string} secret Server secret.
 * @param {string|null|undefined} token Bearer token.
 * @param {number} now Epoch ms.
 * @returns {Promise<string|null>}
 */
export async function verifySession(secret, token, now) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const m = token.match(/^([0-9a-f-]{36})\.(\d{10,16})\.([0-9a-f]{64})$/);
  if (!m) return null;
  const [, userId, iatRaw, sig] = m;
  const iat = Number(iatRaw);
  if (!(iat <= now + 60_000) || now - iat > SESSION_TTL_MS) return null;
  return (await hmacVerify(secret, msg(userId, iat), sig)) ? userId : null;
}
