# KEYSTROKE FORENSICS

A real-time typing performance analyzer built as a **measurement instrument with a verified leaderboard**. Two front-ends, vanilla HTML/CSS/JS and React 18 + Vite, share one framework-agnostic core, and both produce byte-identical metrics for identical input (enforced by an E2E parity test). The server recomputes every leaderboard score from the raw keystroke log using the same core, so a forged client cannot claim a score.

> Course: Advanced Web Programming Lab. Event-driven programming, DOM manipulation and time-based computation. The original 7-step algorithm is preserved as seven named, exported functions (see [the mapping table](#the-original-7-step-algorithm)).

---

## Architecture

```
                 +--------------------------- /core (pure ES modules, no DOM) ---------------------------+
                 |  engine.js  FSM IDLE->ARMED->RUNNING->COMPLETE|FAILED   metrics.js  pure formulas        |
                 |  telemetry.js append-only log (performance.now)        analysis.js bigrams, fingers...   |
                 |  textSource.js seeded PRNG providers, no repeats       dynamics.js keystroke biometrics  |
                 |  modes/*  one module per mode (Mode interface)         replay.js  deterministic replay    |
                 |  verify.js  HMAC tokens + anti-cheat (WebCrypto only)  gamification, lessons, coach      |
                 +-------------------^--------------------------^-----------------------^------------------+
                                     |                          |                       |
        /client (shared browser layer: IndexedDB, settings, input capture, worker, charts, QR, realtime, API)
                    |                                  |                                |
     /vanilla  zero runtime deps          /react  React 18 (useSyncExternalStore)      /server + /supabase
     thin DOM bindings                    memoized <Character> components             runService (platform neutral)
                    \__________________ same IndexedDB / same origin ___________/       Edge Functions (Deno)
                                                   |                                        |
                                    HTTPS (anon JWT, raw keystrokes only)  ------------->  Postgres + RLS + Realtime
```

- **Engine** (`core/engine.js`): explicit transition table, illegal transitions throw. External-store API (`subscribe`/`getSnapshot`) used directly by vanilla and through `useSyncExternalStore` by React.
- **Rendering**: one span per character; each keystroke repaints only the engine's `lastChange` range, and the caret glides with a CSS transform. React uses memoized `Character` components keyed by index.
- **Time**: HUD metrics recompute on `requestAnimationFrame` throttled to 10 Hz; WPM is sampled every 500 ms; heavy analytics (bigrams, consistency, heat, biometrics) run in a module Web Worker.
- **Persistence**: IndexedDB for local history (offline-first, shared by both front-ends); Postgres for leaderboards, either **Render Postgres** behind the Node API (`server/app.mjs`, recommended) or **Supabase** (Edge Functions + RLS).
- **Trust**: all trust decisions live server-side in `server/runService.js`. The same file runs in the Render Node server, in Supabase Edge Functions, and in the local dev server (in-memory store), and a store-contract test suite runs against both the memory store and real Postgres (PGlite).

### File tree

```
core/            engine, metrics, telemetry, textSource, replay, analysis, dynamics, verify,
                 layouts, lessons, gamification, coach, sanitize, prng, corpus/, modes/ (18 modes)
client/          api (Supabase/dev backend), realtime (Phoenix WS / SSE / BroadcastChannel), db (IndexedDB),
                 store (settings), input (keyboard/IME/paste capture), analytics(+worker), charts (SVG),
                 keyboard (heatmap), qr (QR encoder), shareCard (canvas), sound (Web Audio)
vanilla/         index.html, embed.html, sw.js, manifest, styles/ (tokens.css, app.css), src/ (main, typing/, views/, widget.js)
react/           Vite app: hooks/useTypingEngine.js, components/, views/
server/          app.mjs (Render production server), http.js (API + static), session.js, runService.js,
                 coachService.js, pgStore.js + schema.sql (Postgres), memoryStore.js (dev/tests)
supabase/        migrations/ (schema + RLS + SQL functions), functions/ (run-token, submit-run, ai-coach), config.toml
tests/           unit/ (Vitest + fast-check), e2e/ (Playwright), helpers/
tools/           serve.mjs (zero-dep dev server + API), build-vanilla.mjs, deploy.mjs, sync-supabase.mjs, fonts, icons
.github/         CI: lint -> test -> build -> e2e + Lighthouse CI
```

### Database schema (summary)

Two equivalent schemas: `server/schema.sql` (Render Postgres; only the API server can reach the database and every query is scoped to the signed session user) and `supabase/migrations/` (Supabase; the same rules enforced with RLS). The Supabase variant:

| Table | Purpose | Client access |
|---|---|---|
| `profiles(id, handle)` | display handle | read all; insert/update **own row only** |
| `run_tokens(run_id, user_id, mode_id, options, policy, seed, text_hash, nonce, signature, issued_at, expires_at, consumed_at)` | signed, single-use run tokens | none (service role) |
| `runs(id, user_id, board_key, ..., score, status, flags)` | verified results | none directly; read via `get_leaderboard` / `get_personal_board` |
| `run_logs(run_id, entries)` | raw keystroke log for audits | none |
| `rate_events(bucket, at)` | rate limiting | none |
| `cohorts`, `cohort_members` | class / friends boards | members only |

Verification fields (`status`, `flags`) are writable only by the service role. Quarantined runs are shown to their owner as accepted (shadow-ban). Full DDL: `supabase/migrations/20261030000000_init.sql`.

---

## The original 7-step algorithm

| Step | Lab spec | Function (`core/engine.js`) | Where it is triggered |
|---|---|---|---|
| 1 | Display random sentence | `displayRandomSentence(s, {seed, text, ctx})` | `engine.load()` |
| 2 | Start timer on first keystroke | `startTimerOnFirstKeystroke(s, t)` | first printable `keyDown` while ARMED |
| 3 | Capture input continuously | `captureInput(s, action)` | every `keyDown` (char / backspace / strict reject) |
| 4 | Compare with original | `compareWithOriginal(s, pos, ch)` | inside step 3 for every character |
| 5 | Calculate time | `calculateTime(s, tEnd)` | completion, deadline (`tick`) or sudden-death failure |
| 6 | Compute WPM and accuracy | `computeWpmAndAccuracy(s)` -> `metrics.computeCoreMetrics` | right after step 5 |
| 7 | Display results | `displayResults(s, emit)` | publishes to subscribers; the UI renders and `aria-live` announces once |

`tests/unit/engine.test.js` calls all seven by hand.

---

## Metrics: formulas and worked examples

One "word" = 5 characters. `minutes = elapsedMs / 60000`. `elapsed` runs from the first keystroke to completion (timed modes: exactly the duration). Every function returns 0 instead of NaN/Infinity for zero time or empty input.

| Metric | Formula | Worked example |
|---|---|---|
| Gross WPM | `(typedChars / 5) / minutes` | 250 chars in 60 s -> 250/5/1 = **50** |
| Net WPM | `max(0, (typedChars - uncorrectedErrors) / 5 / minutes)` | 250 chars, 10 errors left, 60 s -> 240/5 = **48** |
| Raw accuracy | `correctKeystrokes / totalKeystrokes x 100` (fixed errors still count) | typed `a x <BS> b c d` for "abcd": 4 of 5 correct -> **80%** |
| Final accuracy | `(typedChars - uncorrected) / typedChars x 100` | same run: end text "abcd" -> **100%** |
| Consistency | `100 - CV(inter-key intervals)`, outliers > 3 sigma trimmed, clamped to [0,100] | intervals 100,100,100 -> CV 0 -> **100** |
| Burst WPM | best rolling 5 s window of correct chars (window = run length if shorter, min 1 s) | 50 correct chars in 5 s -> 50/5/(5/60) = **120** |
| Rolling WPM | correct chars in the last 2 s, sampled every 500 ms | drives the sparkline and report chart |
| Fatigue | least-squares slope of rolling WPM (wpm/min) + first-half vs second-half WPM | 60 -> 45 wpm halves -> **-25%** |
| Flow state | 3 s windows (step 500 ms) with interval CV <= 35% and accuracy >= 97%, merged | shaded bands in the report |
| Per-key / per-bigram latency | time since previous keystroke, grouped by expected char / consecutive correct pair | "You slow ~38% on 'th'" |
| Per-finger load | share of keystrokes per finger via the QWERTY/Dvorak/Colemak finger map | bar chart |
| **Leaderboard score** | `netWPM x (finalAccuracy / 100)^2` | 80 wpm at 95% -> 80 x 0.9025 = **72.2** |

Derivation note: squaring accuracy makes sloppy speed lose quadratically. A typist who gains 10% speed by dropping from 98% to 90% accuracy loses about 9% of score instead of gaining.

Edge cases handled: zero elapsed time, empty input, paste (blocked and logged), IME composition (`ime` entries, local only), Android `Unidentified` keys (resolved through `beforeinput`), backspace past the start, auto-repeat (characters ignored, backspace allowed), Ctrl+Backspace word delete, strict policy rejects.

---

## Modes

Core: Sentence, Timed 15/30/60/120 (text streams from seeded chunks), Words 10/25/50/100, Custom (sanitized: NFC, smart quotes, control/zero-width/bidi chars stripped, 2000-char cap).
Skill: Code (JS/Python/C/SQL, auto-indent, per-language boards), Punctuation & numbers, Quote (public-domain or original), Weak-key drill (weighted by history), Blind, Sudden death, Zen, Scrambled/Reverse.
Competitive: Ghost race (replays your PB caret from its log), Daily challenge (seed = hash of UTC day), Duel (room code -> same seed; live opponent caret).
Security: Command mode (shell/nmap/iptables/git, CLI-speed metric), Logs & payloads (SIEM lines, hex, base64), Phishing spot (reserved domains only; red flags explained after the run).
Learning: lessons home row -> top -> bottom -> numbers -> symbols with pass criteria, per layout.
Policy toggle: free or strict backspace.

---

## How to run

Requirements: Node 20.19+ (tested on Node 24).

```bash
npm install
```

```bash
npm run dev
```

Opens the vanilla app at http://localhost:8080/vanilla/ with the **local backend**: the same token/verification code as production, in memory, so ranked runs, leaderboards, cohorts and duels all work offline.

```bash
npm run dev:react
```

React app at http://localhost:5173/react/ (proxies `/api` to the dev server above).

```bash
npm test
```

112 Vitest unit and property tests (metrics, FSM, replay determinism, anti-cheat, services, HTTP/session layer, and a store contract run against both the memory store and real Postgres).

```bash
npx playwright install chromium && npm run test:e2e
```

8 Playwright tests: sentence run, timed run, reset, paste blocking, ranked submit to leaderboard, two-context duel, and vanilla/React parity against a Node replay.

```bash
npm run build
```

Outputs `dist/`: the vanilla app at the root, `dist/react/`, and `/core` + `/client` copied alongside.

### Deploy: Render backend (recommended) + Vercel front-end

**1. Render (backend and a complete copy of the app).** Push this repository to GitHub, then in the Render dashboard choose **New -> Blueprint**, pick the repository, and click **Apply**. `render.yaml` creates:
- `keystroke-forensics`: a Node web service (`node server/app.mjs`) serving both front-ends and the API from one origin, with health check `/api/health`
- `keystroke-db`: a Render Postgres database with an empty IP allow-list (private network only); the schema is applied automatically on boot
- `RUN_TOKEN_SECRET`: generated by Render (256-bit). `ANTHROPIC_API_KEY` and `ALLOWED_ORIGINS` are optional prompts.

The app is then live at `https://keystroke-forensics.onrender.com` (vanilla at `/`, React at `/react/`).

**2. Vercel (front-end pointed at Render).** Either import the GitHub repo in Vercel with the environment variable `KF_API_BASE=https://<service>.onrender.com`, or from the CLI:

```bash
npx vercel login
```

```bash
RENDER_API_URL=https://<service>.onrender.com npm run deploy -- --skip-supabase
```

Then set `ALLOWED_ORIGINS=https://<project>.vercel.app,https://*-<team>.vercel.app` on the Render service so the browser may call the API cross-origin.

Free-tier notes: Render free web services sleep after inactivity (the first request then takes about a minute), and free Render Postgres databases expire after a fixed period unless upgraded. Check Render's current free-tier terms.

**Production smoke test locally** (the exact server Render runs, against Postgres over the wire protocol, no Docker needed):

```bash
KF_SAME_ORIGIN_API=1 npm run build && npm run test:e2e:prod
```

**Alternative: Supabase backend.** `supabase/` holds the schema, RLS policies and three Edge Functions. After `npx supabase login` and creating a project, run `SUPABASE_PROJECT_REF=<ref> npm run deploy`.

---

## Design rationale

**"Flight-data recorder."** A warm near-black surface (`#0E0D0B`), one phosphor-amber accent (`#FFB000`), and muted teal reserved strictly for *correct*. Errors use the amber accent with a wavy underline, so there's no second accent colour. Fraunces handles the display numerals (the live WPM is a 9rem optical-size numeral) and IBM Plex Mono the text and data, both self-hosted so there are no third-party requests. The layout is asymmetric: readout left, typing field centered with generous negative space, telemetry rail right, plus a 1px hairline grid and film grain. Motion is limited to one staggered load-in, the caret glide and the final number roll, all disabled under `prefers-reduced-motion` or the in-app override. Themes are token swaps: amber (default), paper light (also auto-selected by `prefers-color-scheme: light`), terminal green (unlocks at level 3), and high contrast. Responsive at 320 / 768 / 1024 / 1440.

**Why a shared core.** Metrics live in one pure module that runs in the browser, the worker, Node tests and Deno Edge Functions. That makes "identical metrics for identical input" a property of the architecture, not something maintained by hand, and lets the server verify by replay.

**Accessibility.** WCAG 2.1 AA contrast in every theme, visible focus rings, `aria-live="polite"` only for final results (never per keystroke), full keyboard operation (Tab, Esc restart, Ctrl+Enter new text), OpenDyslexic option, four text sizes, high-contrast mode. Lighthouse: vanilla 99/100/100/100, React 100/100/100/100 (Perf/A11y/BP/SEO).

**Security headers.** Strict CSP (`script-src 'self'`, no inline styles or scripts, `connect-src` limited to self, Supabase and onrender.com), `frame-ancestors 'none'` except `embed.html`, nosniff, HSTS, COOP and Permissions-Policy, set in `vercel.json` and by the Node server (`server/http.js`).

**Skills note.** The suggested `awesomedesign.md`, `taste`, `impeccable`, `playwright cli` and `img2threejs` skills were not installed in this environment. The design pass was done by hand against Part 8, and testing uses `@playwright/test` directly.

See also: [THREAT_MODEL.md](THREAT_MODEL.md), [BIOMETRICS.md](BIOMETRICS.md), [VIVA.md](VIVA.md), [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
