# Threat model: Keystroke Forensics leaderboard

Scope: the ranked leaderboard (Supabase Postgres + Edge Functions), the two front-ends, and locally stored data. The local dev server uses the same service code and is out of scope as a deployment target.

## Assets

| Asset | Why it matters |
|---|---|
| Leaderboard integrity | The product's credibility: scores must reflect real human typing |
| Run tokens + `RUN_TOKEN_SECRET` | Forging tokens would allow pre-generated or replayed runs |
| Service-role key | Full database access; lives only in Edge Function env |
| User data: handles, cohort membership, keystroke logs | Keystroke timing is biometric-adjacent data |
| Availability of Edge Functions | Abuse could exhaust free-tier quotas |
| Local data (IndexedDB history, biometric vectors) | Private to the device; must be deletable |

## Attacker goals

1. Top a board without typing (bot, macro, script).
2. Re-submit a good run or submit a run prepared in advance.
3. Inflate a score by tampering with client code or the submitted payload.
4. Read or modify other users' data, or verification fields.
5. Degrade the service (spam tokens and submissions).
6. Farm accounts to flood boards or evade per-user history checks.

## Attack vectors and mitigations

| # | Vector | Mitigation (where) |
|---|---|---|
| A1 | **Macro / bot** typing via synthetic events | `isTrusted` recorded per event; any untrusted event quarantines (`verify.analyzeLogIntegrity`). Bots with real OS input are caught by timing: >= 6 consecutive intervals < 15 ms or median < 25 ms -> `superhuman-interval`; interval CV < 8% over >= 30 keys -> `uniform-timing`; dwell CV < 5% -> `uniform-dwell` |
| A2 | **Missing key pairs** (events injected without keyup) | > max(2, 2%) keydowns without keyup -> `missing-keyup` |
| A3 | **Paste / injected input** | paste, drop and key-less `insertText` are logged as `paste` entries -> `paste-detected`; IME entries -> `unverifiable-input` (local only) |
| A4 | **Replay** of a captured submission | single-use token: `consume_run_token()` atomically sets `consumed_at`; second use -> rejected (`replayed-nonce`) |
| A5 | **Pre-generation** (type offline, submit later) | server picks the seed at token time; token signed over `runId, userId, mode, options, policy, seed, textHash, nonce, issuedAt, expiresAt`; expires 10 min + duration. Wall-clock check: `now - issuedAt >= elapsed - 1 s`, otherwise `wall-clock` |
| A6 | **Forged payload / client tampering** (edited JS, claimed score) | the client never sends a score. The server replays raw `entries` through the shared engine and recomputes everything. Client hints (`op`, `correct`) must match the server replay, otherwise `hint-mismatch`. Text is regenerated from the seed and checked against `textHash` |
| A7 | **Token forgery** | HMAC-SHA256 with a 32-byte server secret, constant-time verify (`crypto.subtle.verify`) |
| A8 | **Using someone else's token** | token row bound to `user_id` from the verified JWT; mismatch -> generic 400 |
| A9 | **Statistical outliers** (a human whose friend typed for them, or a tuned bot) | z-score of the new score vs the user's last 20 verified scores on the same board; z > 3 -> `wpm-spike` (needs >= 5 runs) |
| A10 | **Probing which rule fired** | shadow-ban: quarantined runs get the *same* response as verified runs and look accepted on the owner's personal board, but never appear publicly. Hard rejections return one generic message |
| A11 | **API abuse** | per-user and per-IP sliding-window limits (`rate_hit()`): 30 tokens/min/user, 10 submits/min/user, 30 submits/min/IP, coach 5/min/user; payload size caps (2 MB log, 20k entries) |
| A12 | **Direct DB writes / reads** | RLS on every table; `runs`, `run_logs`, `run_tokens`, `rate_events` have no client policies and explicit `revoke`; reads go through `security definer` functions exposing safe columns only; verification fields writable only by the service role |
| A13 | **XSS -> token theft** | strict CSP (`script-src 'self'`, no inline), all UI text escaped (`html` tagged template), custom text sanitized, chart builders escape labels |
| A14 | **Clickjacking** | `frame-ancestors 'none'` + `X-Frame-Options: DENY` (only `embed.html` is frameable and it holds no actions) |
| A15 | **Account farming** | anonymous accounts are cheap by design; mitigated by IP rate limits and per-user history checks, and the board is best-per-user. Residual risk below |
| A16 | **Prompt injection via the AI coach** | the coach accepts only a strict numeric/short-token schema (`validateCoachPayload`); free text is rejected; the reply is schema-checked (`sanitizePlan`) and rendered escaped |

## STRIDE

| Category | Threat | Control |
|---|---|---|
| **S**poofing | submit as another user; forge tokens | Supabase JWT on every function; token bound to `user_id`; HMAC signatures |
| **T**ampering | edited client, forged metrics, modified log | server-side replay and recompute; hint cross-check; integrity heuristics; RLS write lockdown |
| **R**epudiation | "I never submitted that" | `run_tokens` and `run_logs` retain the issued token and full raw log per run; `created_at` timestamps |
| **I**nformation disclosure | leaking flags, other users' runs or logs | runs not selectable; leaderboard function returns only handle/score/wpm/accuracy; logs service-only; coach receives aggregates only; no trackers |
| **D**enial of service | token/submit floods, huge payloads | rate limits per user and IP, body caps, entry caps, early structural rejection before replay |
| **E**levation of privilege | client acting as service role | service-role key only in Edge Function env; build refuses a key containing `service_role`; `security definer` functions pin `search_path` |

## Residual risks

- **Hardware/OS-level automation with human-like jitter** (e.g. a microcontroller replaying a real human's timing profile) can pass timing heuristics. The z-score and biometrics research partly address this; a determined attacker with a recorded human trace remains the main open risk.
- **Anonymous account farming** across many IPs defeats per-user history. Requiring OAuth or email for ranked play would raise the cost. This is a product decision.
- **Shadow-ban leakage**: an attacker comparing public and personal boards from a second account can infer quarantine. That is acceptable, since it still costs them the score.
- **Thresholds are heuristics** tuned on synthetic data; genuine very fast typists (200+ WPM) may occasionally be quarantined. Flags are retained for manual review.
- **Mobile IME and swipe typing** cannot be verified (no key events) and is local-only by design.
- **Free-tier quotas** can still be exhausted by a distributed attack; Supabase/Vercel platform protections apply.
