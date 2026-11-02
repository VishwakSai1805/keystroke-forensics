/**
 * Test controller: thin DOM bindings over the shared core engine.
 * Wires input -> engine -> view, runs the 10 Hz HUD loop on requestAnimationFrame, ships
 * heavy analytics to the worker, persists runs, submits ranked runs for server verification,
 * and hosts the ghost race, duel and phishing flows.
 */
import { createEngine, STATES } from '../../../core/engine.js';
import { createTextSource } from '../../../core/textSource.js';
import { getMode, resolveOptions, boardKey, createPhishingSession, scorePhishing, phishingScore } from '../../../core/modes/index.js';
import { caretTimeline, ghostCaretAt } from '../../../core/replay.js';
import { utcDay } from '../../../core/prng.js';
import { netWpm, grossWpm, finalAccuracy, rawAccuracy, round, leaderboardScore } from '../../../core/metrics.js';
import { weaknessFromHistory } from '../../../core/analysis.js';
import { applyRun, emptyStats, levelFromXp } from '../../../core/gamification.js';
import { getLesson, lessonPassed } from '../../../core/lessons.js';
import { enrollProfile, MIN_ENROLL_RUNS } from '../../../core/dynamics.js';
import { sparklineSvg } from '../../../client/charts.js';
import { mountKeyboard } from '../../../client/keyboard.js';
import { feedback } from '../../../client/sound.js';
import { createTypingView } from './view.js';
import { attachInput } from '../../../client/input.js';
import { db, listRuns, personalBest } from '../../../client/db.js';
import { $, esc, fmt, html, raw, toast, localDay, rollNumber } from '../dom.js';

const GHOSTABLE = new Set(['sentence', 'timed', 'words', 'code', 'punctuation', 'quote', 'blind', 'scrambled', 'command', 'logs']);
const STORES_TEXT = new Set(['custom', 'weakkey', 'phishing']);

/**
 * @param {{api:ReturnType<import('../../../client/api.js').createApi>, analytics:ReturnType<import('../../../client/analytics.js').createAnalytics>, store:typeof import('../../../client/store.js').store, onComplete:(record:Object)=>void}} deps
 */
export function createController({ api, analytics, store, onComplete }) {
  const engine = createEngine();
  const textSource = createTextSource();
  const els = {
    text: $('#tf-text'),
    viewport: $('#tf-viewport'),
    input: $('#typing-input'),
    hint: $('#focus-hint'),
    metaL: $('#typing-meta-left'),
    metaR: $('#typing-meta-right'),
    wpm: $('#hud-wpm'),
    acc: $('#hud-acc'),
    raw: $('#hud-raw'),
    timer: $('#hud-timer'),
    timerLabel: $('#hud-timer-label'),
    progress: $('#hud-progress'),
    state: $('#hud-state'),
    spark: $('#spark'),
    consistency: $('#rail-consistency'),
    burst: $('#rail-burst'),
    keys: $('#rail-keys'),
    errors: $('#rail-errors'),
    gross: $('#rail-gross'),
    policy: $('#rail-policy'),
    ghostBlock: $('#rail-ghost'),
    ghostPb: $('#ghost-pb'),
    ghostDelta: $('#ghost-delta'),
    duelBlock: $('#rail-duel'),
    identityBlock: $('#rail-identity'),
    identityMeter: $('#identity-meter'),
    identityValue: $('#identity-value'),
    live: $('#results-live'),
    kbWrap: $('#kb-wrap'),
    phish: $('#phishing-panel'),
    rail: $('.rail'),
    grid: $('.test-grid'),
  };
  const view = createTypingView({ textEl: els.text, viewport: els.viewport });
  let keyboard = null;
  let token = null;
  let race = null;
  let samples = [];
  let correctTimes = [];
  let prevCorrect = 0;
  let prevErrors = 0;
  let raf = 0;
  let lastHud = 0;
  let lastSample = 0;
  let lastLive = 0;
  let liveBusy = false;
  let bioProfile = null;
  let phish = null;
  let blockUntil = 0;
  let startGen = 0;

  const settings = () => store.get();

  function setupKeyboard() {
    const s = settings();
    if (!s.showKeyboard) {
      els.kbWrap.replaceChildren();
      keyboard = null;
      return;
    }
    keyboard = mountKeyboard(els.kbWrap, s.layout);
  }
  setupKeyboard();

  /** The live-stats rail is off by default (calmer screen); races always need it. */
  function setRail(r) {
    const show = Boolean(settings().showTelemetry || r);
    els.rail.hidden = !show;
    els.grid.classList.toggle('no-rail', !show);
  }
  setRail(null);
  store.subscribe((s, patch) => {
    if ('showTelemetry' in patch) setRail(race);
    if ('showKeyboard' in patch || 'layout' in patch) setupKeyboard();
    if ('size' in patch || 'font' in patch) requestAnimationFrame(() => view.relayout(engine.getSnapshot()));
  });

  // ---------- input ----------
  const input = attachInput(els.input, {
    down(ev) {
      if (performance.now() < blockUntil) return;
      engine.keyDown(ev);
    },
    up: (ev) => engine.keyUp(ev),
    mark: (kind, t, data) => {
      engine.mark(kind, t, data);
      if (kind === 'paste') toast('Paste is disabled: type it out. (Logged as a paste attempt.)');
    },
    restart,
    next: () => start(),
    intercept(ev) {
      if (performance.now() < blockUntil) return true;
      if (phish && ev.key === 'Enter' && engine.getSnapshot().caret === 0) {
        phishDecide('safe', null);
        return true;
      }
      return false;
    },
  });
  els.input.addEventListener('focus', () => (els.hint.hidden = true));
  els.input.addEventListener('blur', () => {
    els.hint.hidden = false;
    engine.mark('blur', performance.now());
  });
  els.hint.addEventListener('click', () => focus());
  $('#typing').addEventListener('mousedown', (e) => {
    if (e.target.closest('button,select,input,a')) return;
    e.preventDefault();
    focus();
  });

  function focus() {
    els.input.focus({ preventScroll: true });
  }

  // ---------- engine events ----------
  engine.subscribe((ev) => {
    const snap = engine.getSnapshot();
    if (ev.type === 'load') {
      view.load(snap);
      keyboard?.target(settings().coachFingers ? snap.text[0] : null);
      return;
    }
    if (ev.type === 'key') {
      view.update(snap);
      if (snap.counts.correct > prevCorrect) correctTimes.push(performance.now());
      const wasError = snap.counts.total - snap.counts.correct > prevErrors;
      prevCorrect = snap.counts.correct;
      prevErrors = snap.counts.total - snap.counts.correct;
      const s = settings();
      if (s.sound !== 'silent' || s.haptics) feedback(s.sound, wasError ? 'error' : snap.text[snap.caret - 1] === ' ' ? 'space' : 'key', s.haptics);
      if (s.coachFingers) keyboard?.target(snap.text[snap.caret] ?? null);
      if (!raf) loop();
      return;
    }
    if (ev.type === 'complete' || ev.type === 'failed') {
      view.update(snap);
      if (snap.ui && snap.ui.hideTyped) view.reveal(snap);
      if (phish) phishDecide('flag', snap);
      else finish(snap);
    }
  });

  // ---------- HUD ----------
  function renderHud(live, snap) {
    const ui = snap.ui || {};
    const zen = ui.liveStats === false && snap.status === STATES.RUNNING;
    els.state.textContent = snap.status;
    els.wpm.classList.toggle('idle', snap.status !== STATES.RUNNING);
    els.wpm.textContent = zen ? '··' : fmt.n(live.netWpm);
    els.acc.innerHTML = zen || !live.keystrokes ? '--<small>%</small>' : `${esc(fmt.n(live.finalAccuracy, 1))}<small>%</small>`;
    els.raw.innerHTML = zen ? '--<small>wpm</small>' : `${esc(fmt.n(live.grossWpm))}<small>wpm</small>`;
    if (ui.timer === 'none') {
      els.timerLabel.textContent = 'Timer';
      els.timer.textContent = 'off';
    } else if (live.remainingMs !== null) {
      els.timerLabel.textContent = 'Remaining';
      els.timer.textContent = fmt.secs(live.remainingMs);
    } else {
      els.timerLabel.textContent = 'Elapsed';
      els.timer.textContent = fmt.secs(live.elapsedMs);
    }
    els.progress.style.transform = `scaleX(${Math.min(1, live.progress || 0).toFixed(3)})`;
    els.keys.textContent = String(live.keystrokes);
    els.errors.textContent = String(live.errors);
    els.gross.textContent = zen ? '--' : fmt.n(live.grossWpm);
    if (race && race.render) race.render(snap, live);
  }

  function rollingWpm(now) {
    const windowMs = 2000;
    while (correctTimes.length && correctTimes[0] < now - windowMs) correctTimes.shift();
    return round(correctTimes.length / 5 / (windowMs / 60000));
  }

  function renderSpark() {
    els.spark.innerHTML = sparklineSvg(samples.slice(-120), { width: 260, height: 64, max: 60 });
  }

  function renderLive(r) {
    if (!r) return;
    els.consistency.textContent = fmt.pct(r.consistency);
    els.burst.textContent = `${fmt.n(r.burst)} wpm`;
    if (keyboard && r.heat) keyboard.update(r.heat);
    if (r.identity) {
      els.identityBlock.hidden = false;
      els.identityMeter.style.width = `${Math.round(r.identity.confidence * 100)}%`;
      els.identityValue.textContent = `${Math.round(r.identity.confidence * 100)}% (d=${r.identity.distance})`;
    }
  }

  function loop() {
    cancelAnimationFrame(raf);
    const frame = (now) => {
      const snap0 = engine.getSnapshot();
      if (snap0.status === STATES.RUNNING) engine.tick(now);
      const snap = engine.getSnapshot();
      if (race && race.caretAt && snap.startT !== null) view.ghost(race.caretAt(now - snap.startT));
      if (now - lastHud >= 100) {
        lastHud = now;
        renderHud(engine.live(now), snap);
      }
      if (snap.status === STATES.RUNNING && now - lastSample >= 500) {
        lastSample = now;
        samples.push(rollingWpm(now));
        renderSpark();
      }
      if (snap.status === STATES.RUNNING && now - lastLive >= 1000 && !liveBusy) {
        lastLive = now;
        liveBusy = true;
        analytics
          .live({ entries: engine.entries(), startT: snap.startT, now, layout: settings().layout, profile: bioProfile })
          .then(renderLive)
          .catch(() => {})
          .finally(() => (liveBusy = false));
      }
      raf = snap.status === STATES.RUNNING ? requestAnimationFrame(frame) : 0;
    };
    raf = requestAnimationFrame(frame);
  }

  function resetHud() {
    cancelAnimationFrame(raf);
    raf = 0;
    samples = [];
    correctTimes = [];
    prevCorrect = 0;
    prevErrors = 0;
    renderSpark();
    els.consistency.textContent = '--';
    els.burst.textContent = '--';
    els.policy.textContent = settings().policy;
    renderHud(engine.live(performance.now()), engine.getSnapshot());
    keyboard?.update({});
  }

  // ---------- starting runs ----------
  async function loadBioProfile() {
    bioProfile = null;
    els.identityBlock.hidden = true;
    if (!settings().biometrics) return;
    const doc = await db.get('kv', 'bioProfile');
    if (doc && doc.profile) bioProfile = doc.profile;
  }

  function modeOptions(modeId) {
    const s = settings();
    const opts = resolveOptions(modeId, (s.modeOptions || {})[modeId] || {});
    if (modeId === 'daily') opts.day = utcDay(Date.now());
    if (modeId === 'lesson') opts.layout = s.layout;
    return opts;
  }

  function describe(snap, extra = '') {
    const m = getMode(snap.modeId);
    const bits = [m.label];
    const o = snap.options;
    if (o.duration) bits.push(`${o.duration}s`);
    if (o.count && snap.modeId !== 'phishing') bits.push(`${o.count} words`);
    if (o.language) bits.push(o.language);
    if (o.length) bits.push(o.length);
    if (o.day) bits.push(o.day);
    if (o.variant) bits.push(o.variant);
    if (o.set) bits.push(o.set);
    if (o.kind) bits.push(o.kind);
    if (snap.meta && snap.meta.title) bits.push(snap.meta.title);
    els.metaL.innerHTML = html`${bits.join(' · ')}${raw(extra)}`;
    const ranked = token ? 'RANKED · server-verified' : m.scoreRules.ranked && !race ? (api.online ? 'unranked (practice)' : 'offline · local only') : 'local only';
    els.metaR.innerHTML = snap.meta && snap.meta.source ? html`<span class="quote-source">${snap.meta.source}</span> · ${ranked}` : esc(ranked);
  }

  /**
   * Start a fresh run in the configured mode.
   * @param {{race?:Object|null, seed?:number, text?:string, modeId?:string, options?:Object}} [o]
   */
  async function start(o = {}) {
    // Last request wins: a quick second click must not be ignored (it used to be), and a
    // slower, older request must not overwrite a newer one when its network call returns.
    const gen = ++startGen;
    const stale = () => gen !== startGen;
    cancelAnimationFrame(raf);
    raf = 0;
    phish = null;
    els.phish.hidden = true;
    view.ghost(null);
    blockUntil = o.race && o.race.blockUntil ? o.race.blockUntil : 0;
    const s = settings();
    const modeId = o.modeId || s.modeId;
    if (modeId === 'phishing') {
      race = null;
      token = null;
      setRail(null);
      await startPhishing();
      return;
    }
    const mode = getMode(modeId);
    let nextRace = o.race || null;
    let nextToken = null;
    let ghostPb = null;
    let options = { ...modeOptions(modeId), ...(o.options || {}) };
    let loadOpts = { seed: o.seed, text: o.text };
    const ctx = {};
    if (modeId === 'weakkey') {
      ctx.weakness = weaknessFromHistory((await listRuns()).map((r) => r.analysis).filter(Boolean));
      if (stale()) return;
    }

    if (!nextRace && s.ghost && GHOSTABLE.has(modeId) && o.seed === undefined) {
      const pb = await personalBest(boardKey(modeId, options));
      if (stale()) return;
      if (pb) {
        ghostPb = pb;
        options = pb.options;
        loadOpts = { seed: pb.seed, text: pb.customText };
        const timeline = caretTimeline({ modeId, options: pb.options, policy: pb.policy, seed: pb.seed, text: pb.customText, entries: pb.entries });
        nextRace = {
          kind: 'ghost',
          caretAt: (rel) => ghostCaretAt(timeline, rel),
          render(snap) {
            if (snap.startT === null) return;
            const rel = performance.now() - snap.startT;
            const d = snap.caret - ghostCaretAt(timeline, rel);
            els.ghostDelta.textContent = `${d >= 0 ? '+' : ''}${d} chars`;
          },
        };
      }
    }

    if (!nextRace && loadOpts.seed === undefined && mode.scoreRules.ranked && s.ranked && api.online) {
      try {
        const t = await api.runToken(modeId, options, s.policy);
        if (stale()) return;
        nextToken = t;
        options = t.options;
        loadOpts = { seed: t.seed };
        textSource.markUsed(modeId, t.text);
      } catch {
        if (stale()) return;
        nextToken = null;
      }
    }
    if (loadOpts.seed === undefined && !loadOpts.text) {
      const next = textSource.next(modeId, options, ctx);
      loadOpts = { seed: next.seed };
    }
    // Commit: nothing above this line touched shared state after an await.
    race = nextRace;
    token = nextToken;
    els.ghostBlock.hidden = !ghostPb;
    if (ghostPb) {
      els.ghostPb.textContent = `${fmt.n(ghostPb.result.netWpm)} wpm`;
      els.ghostDelta.textContent = '0 chars';
    }
    els.duelBlock.hidden = !(race && race.kind === 'duel');
    setRail(race);
    engine.configure({ modeId, options, policy: race && race.kind === 'duel' ? 'free' : s.policy });
    engine.load({ ...loadOpts, ctx });
    if (token && engine.getSnapshot().text !== token.text) token = null; // defensive: never submit a mismatched run
    await loadBioProfile();
    if (stale()) return;
    describe(engine.getSnapshot(), race && race.kind === 'ghost' ? ' · racing your ghost' : '');
    resetHud();
    focus();
  }

  function restart() {
    const snap = engine.getSnapshot();
    if (phish || token || snap.status === STATES.IDLE || (race && race.kind === 'duel')) {
      if (race && race.kind === 'duel') return;
      start({ race: race && race.kind === 'ghost' ? null : race });
      return;
    }
    engine.restart();
    resetHud();
    focus();
  }

  // ---------- finishing ----------
  function summarize(a) {
    return { ...a, bigrams: a.bigrams.slice(0, 60), errors: a.errors.slice(0, 200) };
  }

  async function applyProgress(result, extra) {
    const stats = (await db.get('kv', 'stats')) || emptyStats();
    const out = applyRun(stats, result, { day: localDay(), hour: new Date().getHours(), ...extra });
    await db.put('kv', out.stats, 'stats');
    if (out.levelUp) toast(`Level ${levelFromXp(out.stats.xp).level} reached`);
    for (const b of out.newBadges) toast(`Badge unlocked: ${b.label}`);
    return out;
  }

  async function finish(snap) {
    cancelAnimationFrame(raf);
    raf = 0;
    const result = snap.result;
    const entries = engine.entries();
    const s = settings();
    renderHud(engine.live(performance.now()), snap);
    rollNumber(els.wpm, result.netWpm, 0);
    els.live.textContent = `${snap.status === STATES.FAILED ? 'Run failed' : 'Run complete'}. ${result.netWpm} net words per minute, ${result.finalAccuracy} percent accuracy, consistency ${result.consistency} percent.`;
    feedback(s.sound, 'bell');
    if (race && race.onFinish) race.onFinish(result);

    const runInput = { text: snap.text, typed: result.typed, entries, startT: snap.startT, endT: snap.endT, autoChars: engine.state.auto.size, layout: s.layout };
    const { analysis, vector } = await analytics.analyze(runInput, s.biometrics);
    const record = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      createdAt: Date.now(),
      modeId: snap.modeId,
      options: snap.options,
      policy: snap.policy,
      boardKey: result.boardKey,
      seed: snap.seed,
      customText: STORES_TEXT.has(snap.modeId) ? snap.text : undefined,
      result,
      analysis: summarize(analysis),
      entries: s.keepLogs ? entries : null,
      verification: token ? 'pending' : 'local',
      race: race ? race.kind : null,
    };
    await db.put('runs', record);
    if (vector && s.biometrics && !snap.result.failed) await saveBioVector(record, vector);
    const progress = await applyProgress(result, { flowPct: analysis.flow.flowPct });
    if (snap.modeId === 'lesson') {
      const lesson = getLesson(snap.options.lessonId);
      const passed = lessonPassed(lesson, result);
      toast(passed ? `Lesson passed: ${lesson.title}` : `Not yet: ${lesson.title} needs ${lesson.pass.minWpm} WPM at ${lesson.pass.minAccuracy}%`);
      if (passed) {
        const done = (await db.get('kv', 'lessons')) || {};
        done[lesson.id] = Math.max(done[lesson.id] || 0, result.netWpm);
        await db.put('kv', done, 'lessons');
      }
    }
    if (token) submit(record, entries);
    onComplete(record, progress);
  }

  async function submit(record, entries) {
    const t = token;
    token = null;
    try {
      const res = await api.submitRun({ runId: t.runId, nonce: t.nonce, entries });
      record.verification = res.status === 'accepted' ? (res.qualified ? 'submitted' : 'unqualified') : 'rejected';
      if (res.result) record.serverResult = res.result;
      toast(res.qualified ? `Submitted for verification: score ${res.result ? res.result.score : record.result.score}` : 'Run recorded but below the leaderboard bar (90% accuracy, minimum length).');
    } catch (e) {
      record.verification = 'rejected';
      toast(`Leaderboard submission failed${e && e.message ? `: ${e.message}` : ''}`);
    }
    await db.put('runs', record);
  }

  async function saveBioVector(record, vector) {
    const label = settings().bioNextLabel === 'impostor' ? 'impostor' : 'genuine';
    if (label === 'impostor') store.set({ bioNextLabel: 'genuine' });
    await db.put('bio', { id: record.id, createdAt: record.createdAt, vector, label });
    if (label !== 'genuine') return;
    const vectors = ((await db.all('bio')) || []).filter((b) => b.label === 'genuine').map((b) => b.vector);
    if (vectors.length >= MIN_ENROLL_RUNS) {
      const prev = await db.get('kv', 'bioProfile');
      const profile = enrollProfile(vectors, prev && prev.profile ? prev.profile.method : 'manhattan');
      await db.put('kv', { profile, updatedAt: Date.now() }, 'bioProfile');
    }
  }

  // ---------- phishing-spot mode ----------
  async function startPhishing() {
    const next = textSource.next('phishing', {});
    phish = { session: createPhishingSession(next.seed, 8), index: 0, decisions: [], rounds: [] };
    token = null;
    els.phish.hidden = false;
    await loadBioProfile();
    phishRound();
    resetHud();
    focus();
  }

  function renderPhishList(done = false) {
    const { session, index, decisions } = phish;
    const items = session.items
      .map((it, i) => {
        const d = decisions[i];
        const right = d && (d === 'flag') === it.suspicious;
        const cls = i === index && !done ? 'current' : d ? (right ? 'right' : 'wrong') : '';
        const verdict = d ? `${d === 'flag' ? 'flagged' : 'marked safe'}${done ? ` · ${it.suspicious ? 'suspicious' : 'legitimate'}` : ''}` : i === index ? 'now' : '';
        const flags = done ? html`<div class="hint-line">${it.flags.join(' · ')}</div>` : '';
        return html`<li class="${cls}">
          <span>${String(i + 1).padStart(2, '0')}</span>
          <div>${it.url}${raw(flags)}</div>
          <span class="verdict">${verdict}</span>
        </li>`;
      })
      .join('');
    els.phish.innerHTML = html`<h3>Phishing spot</h3>
      <p class="hint-line">Type the URL to <strong>flag it as suspicious</strong>. Press <kbd>Enter</kbd> on an empty line to mark it <strong>safe</strong>. All domains are reserved test names.</p>
      <ol class="url-list">
        ${raw(items)}
      </ol>`;
  }

  function phishRound() {
    const item = phish.session.items[phish.index];
    engine.configure({ modeId: 'phishing', options: {}, policy: settings().policy });
    engine.load({ seed: phish.session.seed, text: item.url });
    describe(engine.getSnapshot(), ` · URL ${phish.index + 1} of ${phish.session.items.length}`);
    renderPhishList();
  }

  function phishDecide(decision, snap) {
    if (snap && snap.result) phish.rounds.push({ result: snap.result, entries: engine.entries() });
    phish.decisions.push(decision);
    phish.index++;
    if (phish.index < phish.session.items.length) {
      phishRound();
      resetHud();
      return;
    }
    finishPhishing();
  }

  async function finishPhishing() {
    const { session, decisions, rounds } = phish;
    const det = scorePhishing(session.items, decisions);
    const chars = rounds.reduce((a, r) => a + r.result.typedChars, 0);
    const unc = rounds.reduce((a, r) => a + r.result.uncorrectedErrors, 0);
    const ms = rounds.reduce((a, r) => a + r.result.elapsedMs, 0);
    const correct = rounds.reduce((a, r) => a + r.result.correctKeystrokes, 0);
    const total = rounds.reduce((a, r) => a + r.result.totalKeystrokes, 0);
    const typed = rounds.map((r) => r.result.typed).join(' ');
    const text = rounds.map((r) => r.result.text).join(' ');
    const net = round(netWpm(chars, unc, ms));
    const result = {
      elapsedMs: ms,
      typedChars: chars,
      uncorrectedErrors: unc,
      correctKeystrokes: correct,
      totalKeystrokes: total,
      backspaces: rounds.reduce((a, r) => a + r.result.backspaces, 0),
      grossWpm: round(grossWpm(chars, ms)),
      netWpm: net,
      rawAccuracy: round(rawAccuracy(correct, total)),
      finalAccuracy: round(finalAccuracy(typed, text)),
      consistency: rounds.length ? round(rounds.reduce((a, r) => a + r.result.consistency, 0) / rounds.length) : 0,
      burstWpm: rounds.length ? Math.max(...rounds.map((r) => r.result.burstWpm)) : 0,
      score: phishingScore(net, det.detectionAccuracy),
      extras: { ...det },
      modeId: 'phishing',
      options: {},
      policy: settings().policy,
      seed: session.seed,
      boardKey: 'phishing',
      ranked: false,
      text,
      typed,
      meta: {},
      failed: false,
      failReason: null,
    };
    renderPhishList(true);
    els.wpm.textContent = fmt.n(net);
    els.live.textContent = `Phishing round complete. Detection accuracy ${det.detectionAccuracy} percent, ${net} net words per minute.`;
    const entries = rounds.flatMap((r) => r.entries);
    const record = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      createdAt: Date.now(),
      modeId: 'phishing',
      options: {},
      policy: result.policy,
      boardKey: 'phishing',
      seed: session.seed,
      customText: text,
      result,
      analysis: null,
      phishing: session.items.map((it, i) => ({ ...it, decision: decisions[i] })),
      entries: null,
      verification: 'local',
      race: null,
    };
    if (entries.length && rounds.length) {
      const firstStart = entries[0].tDown;
      const { analysis } = await analytics.analyze({ text, typed, entries: entries.filter((e) => e.kind === 'key'), startT: firstStart, endT: firstStart + ms, layout: settings().layout });
      record.analysis = summarize({ ...analysis, metrics: { ...analysis.metrics, netWpm: net, finalAccuracy: result.finalAccuracy } });
    }
    await db.put('runs', record);
    const progress = await applyProgress(result, { detectionAccuracy: det.detectionAccuracy });
    phish = null;
    onComplete(record, progress);
  }

  return {
    engine,
    start,
    restart,
    focus,
    /** Forward a key pressed while the field was not focused. */
    forwardKey(e) {
      focus();
      input.keydown(e);
    },
    /** Duel / ghost race adaptor. */
    setRace(r) {
      race = r;
    },
    /** Repaint the opponent / ghost caret outside the typing loop (remote progress arrived). */
    syncRace() {
      const snap = engine.getSnapshot();
      if (race && race.caretAt) view.ghost(race.caretAt(snap.startT === null ? 0 : performance.now() - snap.startT));
    },
    get running() {
      return engine.getSnapshot().status === STATES.RUNNING;
    },
    get race() {
      return race;
    },
    score: leaderboardScore,
  };
}
