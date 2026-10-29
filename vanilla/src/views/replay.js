/** Full run replay at 1x / 2x / 4x: re-feeds the stored keystroke log through the same engine. */
import { createEngine } from '../../../core/engine.js';
import { buildReplayEvents, applyReplayEvent } from '../../../core/replay.js';
import { createTypingView } from '../typing/view.js';
import { db } from '../../../client/db.js';
import { html, fmt } from '../dom.js';

export async function mount(el, app, [id]) {
  const run = id ? await db.get('runs', id) : null;
  if (!run || !run.entries || !run.entries.length) {
    el.innerHTML = html`<div class="page-head">
      <div>
        <h2 id="replay-title">Replay</h2>
        <p>This run has no stored keystroke log (logs can be disabled in Settings).</p>
      </div>
      <a class="btn" href="#/history">Back to history</a>
    </div>`;
    return;
  }
  el.innerHTML = html` <div class="page-head">
      <div>
        <h2 id="replay-title">Replay</h2>
        <p>${run.boardKey} · ${fmt.date(run.createdAt)} · rebuilt keystroke by keystroke from the log</p>
      </div>
      <a class="btn ghost" href="#/report/${run.id}">Report</a>
    </div>
    <div class="replay-bar">
      <button class="btn primary" type="button" id="rp-play">Play</button>
      <div class="chips" role="group" aria-label="Speed">
        <button class="chip" type="button" data-speed="1" aria-pressed="true">1x</button><button class="chip" type="button" data-speed="2" aria-pressed="false">2x</button
        ><button class="chip" type="button" data-speed="4" aria-pressed="false">4x</button>
      </div>
      <label class="sr-only" for="rp-seek">Position</label><input type="range" id="rp-seek" min="0" max="1000" value="0" />
      <span class="timer" id="rp-time">0.0s</span>
    </div>
    <div class="stat-strip">
      <div>
        <span class="label">Net WPM</span>
        <div class="metric accent" id="rp-wpm">0</div>
      </div>
      <div>
        <span class="label">Accuracy</span>
        <div class="metric" id="rp-acc">--</div>
      </div>
      <div>
        <span class="label">Keystrokes</span>
        <div class="metric" id="rp-keys">0</div>
      </div>
    </div>
    <div class="typing">
      <div class="tf-viewport"><div class="tf-text" id="rp-text"></div></div>
    </div>`;

  const events = buildReplayEvents(run.entries);
  const t0 = events[0].t;
  const total = Math.max(1, events[events.length - 1].t - t0);
  const textEl = el.querySelector('#rp-text');
  const view = createTypingView({ textEl, viewport: textEl.parentElement });
  let engine;
  let idx = 0;
  let vt = 0;
  let speed = 1;
  let playing = false;
  let raf = 0;
  let last = 0;

  const ui = {
    wpm: el.querySelector('#rp-wpm'),
    acc: el.querySelector('#rp-acc'),
    keys: el.querySelector('#rp-keys'),
    time: el.querySelector('#rp-time'),
    seek: el.querySelector('#rp-seek'),
    play: el.querySelector('#rp-play'),
  };

  function reset() {
    engine = createEngine({ modeId: run.modeId, options: run.options, policy: run.policy });
    engine.subscribe((ev) => {
      const snap = engine.getSnapshot();
      if (ev.type === 'load') view.load(snap);
      else view.update(snap);
    });
    engine.load({ seed: run.seed, text: run.customText });
    idx = 0;
  }
  function advanceTo(target) {
    while (idx < events.length && events[idx].t - t0 <= target) applyReplayEvent(engine, events[idx++]);
  }
  function paint() {
    const live = engine.live(t0 + vt);
    ui.wpm.textContent = fmt.n(live.netWpm);
    ui.acc.textContent = live.keystrokes ? `${fmt.n(live.finalAccuracy, 1)}%` : '--';
    ui.keys.textContent = String(live.keystrokes);
    ui.time.textContent = `${fmt.secs(vt)} / ${fmt.secs(total)}`;
    ui.seek.value = String(Math.round((vt / total) * 1000));
  }
  function seek(target) {
    if (target < vt) reset();
    vt = Math.max(0, Math.min(total, target));
    advanceTo(vt);
    paint();
  }
  function frame(now) {
    if (!playing) return;
    vt = Math.min(total, vt + (now - last) * speed);
    last = now;
    advanceTo(vt);
    paint();
    if (vt >= total) {
      playing = false;
      ui.play.textContent = 'Replay';
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (vt >= total) seek(0);
    playing = true;
    ui.play.textContent = 'Pause';
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    ui.play.textContent = 'Play';
  }

  reset();
  paint();
  ui.play.onclick = () => (playing ? pause() : play());
  ui.seek.oninput = () => {
    pause();
    seek((Number(ui.seek.value) / 1000) * total);
  };
  el.querySelector('.replay-bar .chips').onclick = (e) => {
    const b = e.target.closest('[data-speed]');
    if (!b) return;
    speed = Number(b.dataset.speed);
    for (const c of el.querySelectorAll('[data-speed]')) c.setAttribute('aria-pressed', String(c === b));
  };
  return () => pause();
}
