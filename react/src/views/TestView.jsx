import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { listModes, getMode, resolveOptions, boardKey } from '@core/modes/index.js';
import { createTextSource } from '@core/textSource.js';
import { caretTimeline, ghostCaretAt } from '@core/replay.js';
import { weaknessFromHistory } from '@core/analysis.js';
import { applyRun, emptyStats } from '@core/gamification.js';
import { utcDay } from '@core/prng.js';
import { DURATIONS } from '@core/modes/timed.js';
import { COUNTS } from '@core/modes/words.js';
import { CODE_LANGUAGES } from '@core/corpus/code.js';
import { attachInput } from '@client/input.js';
import { feedback } from '@client/sound.js';
import { db, listRuns, personalBest } from '@client/db.js';
import { useTypingEngine, useLiveMetrics } from '../hooks/useTypingEngine.js';
import { TypingField } from '../components/TypingField.jsx';
import { Sparkline } from '../components/Sparkline.jsx';
import { Keyboard } from '../components/Keyboard.jsx';

const OPTION_SETS = {
  timed: { key: 'duration', values: DURATIONS, label: (v) => `${v}s` },
  words: { key: 'count', values: COUNTS, label: (v) => String(v) },
  code: { key: 'language', values: CODE_LANGUAGES, label: (v) => v },
  quote: { key: 'length', values: ['short', 'medium', 'long'], label: (v) => v },
  punctuation: { key: 'count', values: [25, 50], label: (v) => `${v} words` },
  scrambled: { key: 'variant', values: ['scramble', 'reverse'], label: (v) => v },
  logs: { key: 'kind', values: ['siem', 'payload'], label: (v) => v },
};
const REACT_MODES = listModes().filter((m) => !['duel', 'phishing', 'lesson'].includes(m.id));
const GHOSTABLE = new Set(['sentence', 'timed', 'words', 'code', 'punctuation', 'quote', 'blind', 'scrambled', 'command', 'logs']);
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '--');

export function TestView({ api, analytics, settings, setSettings, navigate }) {
  const { engine, snapshot } = useTypingEngine();
  const textSource = useMemo(() => createTextSource(), []);
  const inputRef = useRef(null);
  const token = useRef(null);
  const finishedVersion = useRef(-1);
  const correctTimes = useRef([]);
  const prev = useRef({ correct: 0, errors: 0 });
  const [race, setRace] = useState(null);
  const [samples, setSamples] = useState([]);
  const [telemetry, setTelemetry] = useState(null);
  const [lastRecord, setLastRecord] = useState(null);
  const [rankedLabel, setRankedLabel] = useState('');
  const running = snapshot.status === 'RUNNING';
  const live = useLiveMetrics(engine, running);
  const modeId = settings.modeId === 'duel' || settings.modeId === 'phishing' || settings.modeId === 'lesson' ? 'sentence' : settings.modeId;
  const mode = getMode(modeId);

  const focus = () => inputRef.current && inputRef.current.focus({ preventScroll: true });

  const start = useCallback(async () => {
    const opts0 = resolveOptions(modeId, (settings.modeOptions || {})[modeId] || {});
    if (modeId === 'daily') opts0.day = utcDay(Date.now());
    let options = opts0;
    let loadOpts = {};
    const ctx = {};
    let nextRace = null;
    token.current = null;
    if (modeId === 'weakkey') ctx.weakness = weaknessFromHistory((await listRuns()).map((r) => r.analysis).filter(Boolean));
    if (settings.ghost && GHOSTABLE.has(modeId)) {
      const pb = await personalBest(boardKey(modeId, options));
      if (pb) {
        options = pb.options;
        loadOpts = { seed: pb.seed, text: pb.customText };
        const timeline = caretTimeline({ modeId, options: pb.options, policy: pb.policy, seed: pb.seed, text: pb.customText, entries: pb.entries });
        nextRace = { timeline, pb: pb.result.netWpm };
      }
    }
    if (!nextRace && mode.scoreRules.ranked && settings.ranked && api.online) {
      try {
        const t = await api.runToken(modeId, options, settings.policy);
        token.current = t;
        options = t.options;
        loadOpts = { seed: t.seed };
      } catch {
        token.current = null;
      }
    }
    if (loadOpts.seed === undefined && !loadOpts.text) loadOpts = { seed: textSource.next(modeId, options, ctx).seed };
    engine.configure({ modeId, options, policy: settings.policy });
    engine.load({ ...loadOpts, ctx });
    if (token.current && engine.getSnapshot().text !== token.current.text) token.current = null;
    setRankedLabel(token.current ? 'RANKED · server-verified' : nextRace ? 'racing your ghost' : 'local only');
    setRace(nextRace);
    setSamples([]);
    setTelemetry(null);
    setLastRecord(null);
    correctTimes.current = [];
    prev.current = { correct: 0, errors: 0 };
    focus();
  }, [engine, textSource, modeId, mode, settings, api]);

  useEffect(() => {
    start();
  }, [modeId, JSON.stringify((settings.modeOptions || {})[modeId] || {}), settings.policy, settings.ghost]); // eslint-disable-line react-hooks/exhaustive-deps

  // Input capture: same module as the vanilla app.
  useEffect(() => {
    const restart = () => {
      if (token.current || engine.getSnapshot().status === 'IDLE') start();
      else engine.restart();
    };
    const h = attachInput(inputRef.current, {
      down: (ev) => engine.keyDown(ev),
      up: (ev) => engine.keyUp(ev),
      mark: (kind, t, data) => engine.mark(kind, t, data),
      restart,
      next: () => start(),
    });
    const blur = () => engine.mark('blur', performance.now());
    inputRef.current.addEventListener('blur', blur);
    const el = inputRef.current;
    const global = (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select')) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        if (t && t.closest && t.closest('button, a') && (e.key === ' ' || e.key === 'Enter')) return;
        e.preventDefault();
        focus();
        h.keydown(e);
      }
    };
    document.addEventListener('keydown', global);
    return () => {
      h.detach();
      el.removeEventListener('blur', blur);
      document.removeEventListener('keydown', global);
    };
  }, [engine, start]);

  // Per-keystroke side effects: sound, rolling WPM samples.
  useEffect(() => {
    const c = snapshot.counts;
    const errors = c.total - c.correct;
    if (c.correct > prev.current.correct) correctTimes.current.push(performance.now());
    if (snapshot.status === 'RUNNING' && c.total > 0 && (settings.sound !== 'silent' || settings.haptics)) feedback(settings.sound, errors > prev.current.errors ? 'error' : 'key', settings.haptics);
    prev.current = { correct: c.correct, errors };
  }, [snapshot.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // 500 ms WPM samples and 1 s worker telemetry while running.
  useEffect(() => {
    if (!running) return undefined;
    const sampler = setInterval(() => {
      const now = performance.now();
      correctTimes.current = correctTimes.current.filter((t) => t >= now - 2000);
      setSamples((s) => [...s, Math.round((correctTimes.current.length / 5 / (2000 / 60000)) * 10) / 10]);
    }, 500);
    let busy = false;
    const worker = setInterval(() => {
      if (busy) return;
      busy = true;
      const s = engine.getSnapshot();
      analytics
        .live({ entries: engine.entries(), startT: s.startT, now: performance.now(), layout: settings.layout, profile: null })
        .then(setTelemetry)
        .catch(() => {})
        .finally(() => (busy = false));
    }, 1000);
    return () => {
      clearInterval(sampler);
      clearInterval(worker);
    };
  }, [running, engine, analytics, settings.layout]);

  // STEP 7 in React: on completion analyse, persist and (if ranked) submit.
  useEffect(() => {
    if ((snapshot.status !== 'COMPLETE' && snapshot.status !== 'FAILED') || finishedVersion.current === snapshot.version) return;
    finishedVersion.current = snapshot.version;
    const result = snapshot.result;
    const entries = engine.entries();
    (async () => {
      const { analysis } = await analytics.analyze({
        text: snapshot.text,
        typed: result.typed,
        entries,
        startT: snapshot.startT,
        endT: snapshot.endT,
        autoChars: engine.state.auto.size,
        layout: settings.layout,
      });
      const record = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        modeId: snapshot.modeId,
        options: snapshot.options,
        policy: snapshot.policy,
        boardKey: result.boardKey,
        seed: snapshot.seed,
        customText: ['custom', 'weakkey'].includes(snapshot.modeId) ? snapshot.text : undefined,
        result,
        analysis: { ...analysis, bigrams: analysis.bigrams.slice(0, 60), errors: analysis.errors.slice(0, 200) },
        entries: settings.keepLogs ? entries : null,
        verification: token.current ? 'pending' : 'local',
        race: race ? 'ghost' : null,
        frontEnd: 'react',
      };
      await db.put('runs', record);
      const stats = (await db.get('kv', 'stats')) || emptyStats();
      const d = new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await db.put('kv', applyRun(stats, result, { day, hour: d.getHours(), flowPct: analysis.flow.flowPct }).stats, 'stats');
      setLastRecord(record);
      const t = token.current;
      token.current = null;
      if (t) {
        try {
          const res = await api.submitRun({ runId: t.runId, nonce: t.nonce, entries });
          record.verification = res.qualified ? 'submitted' : 'unqualified';
        } catch {
          record.verification = 'rejected';
        }
        await db.put('runs', record);
        setLastRecord({ ...record });
      }
    })();
  }, [snapshot.status, snapshot.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const ghostPos = race && snapshot.startT !== null && running ? ghostCaretAt(race.timeline, performance.now() - snapshot.startT) : null;
  const ui = snapshot.ui || {};
  const zen = ui.liveStats === false && running;
  const optSet = OPTION_SETS[modeId];
  const curOpts = resolveOptions(modeId, (settings.modeOptions || {})[modeId] || {});
  const setOpt = (k, v) => setSettings({ modeOptions: { ...(settings.modeOptions || {}), [modeId]: { ...curOpts, [k]: v } } });
  const done = snapshot.status === 'COMPLETE' || snapshot.status === 'FAILED';

  return (
    <section className="view active" aria-labelledby="test-title">
      <h1 id="test-title" className="sr-only">
        Typing test
      </h1>
      <div className="test-grid">
        <aside className="readout" aria-label="Live readout">
          <div>
            <span className="label">Net WPM</span>
            <div className={`big-wpm${running ? '' : ' idle'}`} id="hud-wpm" aria-hidden="true">
              {zen ? '··' : fmt(done ? snapshot.result.netWpm : live.netWpm)}
            </div>
          </div>
          <div className="pair">
            <div>
              <span className="label">Accuracy</span>
              <div className="metric">
                {zen || !live.keystrokes ? '--' : fmt(done ? snapshot.result.finalAccuracy : live.finalAccuracy, 1)}
                <small>%</small>
              </div>
            </div>
            <div>
              <span className="label">Raw</span>
              <div className="metric">
                {zen ? '--' : fmt(live.grossWpm)}
                <small>wpm</small>
              </div>
            </div>
          </div>
          <div>
            <span className="label">{ui.timer === 'none' ? 'Timer' : live.remainingMs !== null ? 'Remaining' : 'Elapsed'}</span>
            <div className="timer">{ui.timer === 'none' ? 'off' : `${((live.remainingMs ?? live.elapsedMs) / 1000).toFixed(1)}s`}</div>
            <div className="progress-track" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(1, live.progress || 0)})` }} />
            </div>
          </div>
          <div>
            <span className="label">State</span>
            <div className="timer" id="hud-state">
              {snapshot.status}
            </div>
          </div>
        </aside>

        <div className="center">
          <div className="modebar">
            <label className="sr-only" htmlFor="mode-select">
              Mode
            </label>
            <select id="mode-select" value={modeId} onChange={(e) => setSettings({ modeId: e.target.value })}>
              {REACT_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {optSet && (
              <div className="chips" role="group" aria-label="Mode options">
                {optSet.values.map((v) => (
                  <button key={v} type="button" className="chip" aria-pressed={String(curOpts[optSet.key]) === String(v)} onClick={() => setOpt(optSet.key, v)}>
                    {optSet.label(v)}
                  </button>
                ))}
              </div>
            )}
            <div className="chips" role="group" aria-label="Run options">
              <button type="button" className="chip" aria-pressed={settings.policy === 'strict'} onClick={() => setSettings({ policy: settings.policy === 'strict' ? 'free' : 'strict' })}>
                strict backspace
              </button>
              {mode.scoreRules.ranked && (
                <button type="button" className="chip" aria-pressed={Boolean(settings.ghost)} onClick={() => setSettings({ ghost: !settings.ghost })}>
                  ghost
                </button>
              )}
              {mode.scoreRules.ranked && (
                <button type="button" className="chip" aria-pressed={Boolean(settings.ranked)} onClick={() => setSettings({ ranked: !settings.ranked })}>
                  ranked
                </button>
              )}
            </div>
            <button type="button" className="btn ghost" onClick={start}>
              new text
            </button>
          </div>
          <div>
            <div className="typing-meta">
              <span>
                {mode.label}
                {snapshot.meta && snapshot.meta.source ? ` · ${snapshot.meta.source}` : ''}
              </span>
              <span>
                {lastRecord ? (
                  <a href={`#/report/${lastRecord.id}`} id="report-link">
                    Full report -&gt;
                  </a>
                ) : (
                  rankedLabel
                )}
              </span>
            </div>
            <TypingField snapshot={snapshot} ghostPos={ghostPos} inputRef={inputRef} onFocus={focus} />
          </div>
          <p className="hint-line">
            <kbd>Esc</kbd> restart · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> new text · timer starts on your first key
          </p>
          {settings.showKeyboard && <Keyboard layout={settings.layout} heat={telemetry && telemetry.heat} target={settings.coachFingers ? snapshot.text[snapshot.caret] : null} />}
        </div>

        <aside className="rail" aria-label="Telemetry">
          <div className="rail-block">
            <span className="label">WPM trace</span>
            <Sparkline values={samples} />
          </div>
          <div className="rail-block">
            <div className="rail-row">
              <span>Consistency</span>
              <span>{telemetry ? `${fmt(telemetry.consistency, 1)}%` : '--'}</span>
            </div>
            <div className="rail-row">
              <span>Burst (5 s)</span>
              <span>{telemetry ? `${fmt(telemetry.burst)} wpm` : '--'}</span>
            </div>
            <div className="rail-row">
              <span>Keystrokes</span>
              <span>{live.keystrokes}</span>
            </div>
            <div className="rail-row">
              <span>Errors</span>
              <span>{live.errors}</span>
            </div>
            <div className="rail-row">
              <span>Policy</span>
              <span>{settings.policy}</span>
            </div>
          </div>
          {race && (
            <div className="rail-block">
              <span className="label">Ghost race</span>
              <div className="rail-row">
                <span>Personal best</span>
                <span>{fmt(race.pb)} wpm</span>
              </div>
              <div className="rail-row">
                <span>Lead</span>
                <span>{ghostPos === null ? '--' : `${snapshot.caret - ghostPos} chars`}</span>
              </div>
            </div>
          )}
          {lastRecord && (
            <div className="rail-block">
              <span className="label">Result</span>
              <div className="rail-row">
                <span>Net WPM</span>
                <span>{fmt(lastRecord.result.netWpm)}</span>
              </div>
              <div className="rail-row">
                <span>Consistency</span>
                <span>{fmt(lastRecord.result.consistency)}%</span>
              </div>
              <div className="rail-row">
                <span>Status</span>
                <span>{lastRecord.verification}</span>
              </div>
              <button type="button" className="btn" onClick={() => navigate(`#/report/${lastRecord.id}`)}>
                Report
              </button>
            </div>
          )}
        </aside>
      </div>
      <div className="sr-only" aria-live="polite">
        {done && snapshot.result ? `Run complete. ${snapshot.result.netWpm} net words per minute, ${snapshot.result.finalAccuracy} percent accuracy.` : ''}
      </div>
    </section>
  );
}
