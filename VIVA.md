# Viva: 10 likely examiner questions

**1. Where is the original 7-step algorithm?**
`core/engine.js` exports one function per step: `displayRandomSentence`, `startTimerOnFirstKeystroke`, `captureInput`, `compareWithOriginal`, `calculateTime`, `computeWpmAndAccuracy`, `displayResults`. The engine composes them, and `tests/unit/engine.test.js` calls them individually.

**2. Why a finite state machine?**
It makes illegal states impossible. The transition table (`TRANSITIONS`) lists every legal move, `transition()` throws on anything else, and keystrokes are ignored outside ARMED/RUNNING. That removes classic bugs like timers starting twice or input after the end.

**3. Gross vs net WPM vs accuracy?**
Gross = (chars/5)/min. Net subtracts uncorrected errors. Raw accuracy counts every wrong keystroke even if fixed; final accuracy judges only the end text. Example: "abcd" typed a, x, backspace, b, c, d gives raw 80%, final 100%.

**4. How do you avoid NaN or Infinity?**
Every metric guards `elapsed <= 0` and empty input and returns 0. `finite()` and `clamp()` wrap outputs, and fast-check property tests assert accuracy is in [0,100] and WPM >= 0 for arbitrary inputs.

**5. Why `performance.now()` and not `Date.now()`?**
It's monotonic and sub-millisecond, and unaffected by clock changes or NTP jumps. The app uses `event.timeStamp`, which is on the same clock and closer to the hardware event.

**6. How does the server know a score is genuine?**
The client never sends a score. It gets a signed, single-use token (server-chosen seed), types, and submits the raw keystroke log. The server replays it through the same engine, recomputes the metrics, and runs integrity checks: untrusted events, paste, missing keyups, superhuman or uniform timing, wall-clock vs duration, hint mismatch, and z-score spikes.

**7. What is a shadow-ban and why use it?**
Flagged runs are stored as `quarantined` and the API response is identical to a verified run, so an attacker can't binary-search which rule caught them. They just never reach the public board.

**8. How are both front-ends guaranteed identical?**
Both import the same `/core`. React only subscribes via `useSyncExternalStore`. A Playwright parity test types a run in each app, reads the log from IndexedDB, replays it in Node, and asserts deep equality of the metrics.

**9. Performance: how do you keep input-to-paint under 16 ms?**
Per keystroke the engine does O(1) work and the view repaints only the changed spans (the `lastChange` range). Metrics update at 10 Hz on rAF, and bigrams, consistency, heatmap and biometrics run in a Web Worker. React memoizes each `Character`. Lighthouse Performance is 99-100.

**10. What are the limits of the biometrics demo?**
Few enrollment runs, synthetic impostors flatter the EER, rhythm drifts with fatigue and keyboards, and it's unfair to users with motor impairments. It's opt-in, local-only, stores aggregate vectors only, and is never used for access decisions (see BIOMETRICS.md).
