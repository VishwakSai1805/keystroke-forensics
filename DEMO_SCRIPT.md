# 3-minute live demo script

Setup beforehand: `npm run dev` (or open the deployed URL). Have one finished run in history and a second browser window ready for the duel. Set the browser zoom so the three columns are visible.

**0:00-0:20 | The instrument.** Open the Test view. "This is a measurement instrument, not a game. Left: live net WPM. Centre: the text. Right: the telemetry rail." Point at the state readout: ARMED. "The timer only starts on my first key; that's step 2 of the original algorithm."

**0:20-0:55 | A ranked run.** Pick **Words -> 25** (label shows *RANKED · server-verified*). Type it, making one deliberate mistake and fixing it. Point out the teal correct characters, the amber error, the sparkline, consistency and burst, and the keyboard heatmap filling in. On finish the number rolls to the final value.

**0:55-1:30 | Forensics.** Click *Full report*. Walk through the WPM-over-time chart (error ticks, shaded flow state), the one-line diagnosis ("You slow ~38% on 'th'..."), the slowest bigrams, the finger load and the heatmap. Show that raw accuracy (counts the fixed error) is lower than final accuracy. Click **Replay** at 4x: "rebuilt from the keystroke log through the same engine."

**1:30-2:05 | Anti-cheat.** Open **Boards**: the run appears, verified server-side. "The client never sends a score. The server replays the raw keystrokes and recomputes everything." Show `tests/unit/verify.test.js` or run `npm test -- verify`: bot timing, replayed nonce, forged signature and paste injection are rejected, and the human log passes. Mention the shadow-ban.

**2:05-2:35 | Competitive and security modes.** Second window: **Duel** -> create room, join with the code, start. Both carets move live. Then switch mode to **Phishing spot**: type one suspicious URL and Enter past a safe one, and show the red-flag debrief.

**2:35-3:00 | Research and polish.** **Biometrics** page: consent, enrollment, ROC/EER. "Opt-in, local-only, statistics only." Then **Settings**: switch to paper-light and high-contrast, and the OpenDyslexic font. Close with "Same core, two front-ends: the React build at /react produces byte-identical metrics, and a Playwright test proves it."
