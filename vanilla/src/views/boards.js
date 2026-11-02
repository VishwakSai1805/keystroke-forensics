/** Leaderboards: daily / weekly / all-time per board, cohort boards, personal board, live updates. */
import { listModes, boardKey } from '../../../core/modes/index.js';
import { DURATIONS } from '../../../core/modes/timed.js';
import { COUNTS } from '../../../core/modes/words.js';
import { CODE_LANGUAGES } from '../../../core/corpus/code.js';
import { COMMANDS } from '../../../core/corpus/security.js';
import { utcDay } from '../../../core/prng.js';
import { lineChart } from '../../../client/charts.js';
import { html, raw, fmt, toast, fitChart } from '../dom.js';

/** Every ranked board key, grouped. Modes are never mixed. */
export function rankedBoards() {
  const out = [];
  for (const m of listModes()) {
    if (!m.scoreRules.ranked) continue;
    if (m.id === 'timed') for (const d of DURATIONS) out.push(boardKey('timed', { duration: d }));
    else if (m.id === 'words') for (const c of COUNTS) out.push(boardKey('words', { count: c }));
    else if (m.id === 'code') for (const l of CODE_LANGUAGES) out.push(boardKey('code', { language: l }));
    else if (m.id === 'quote') for (const l of ['short', 'medium', 'long']) out.push(boardKey('quote', { length: l }));
    else if (m.id === 'punctuation') for (const c of [25, 50]) out.push(boardKey('punctuation', { count: c }));
    else if (m.id === 'scrambled') for (const v of ['scramble', 'reverse']) out.push(boardKey('scrambled', { variant: v }));
    else if (m.id === 'command') for (const s of ['all', ...Object.keys(COMMANDS)]) out.push(boardKey('command', { set: s }));
    else if (m.id === 'logs') for (const k of ['siem', 'payload']) out.push(boardKey('logs', { kind: k }));
    else if (m.id === 'daily') out.push(boardKey('daily', { day: utcDay(Date.now()) }));
    else out.push(boardKey(m.id, {}));
  }
  return out;
}

export async function mount(el, app) {
  const { api } = app;
  const state = { board: 'timed:30', period: 'daily', cohort: '' };
  let channel = null;

  if (!api.online) {
    el.innerHTML = html`<div class="page-head">
      <div>
        <h2 id="boards-title">Leaderboards</h2>
        <p>The leaderboard needs the backend (Supabase in production, or <code>npm run dev</code> locally). Your personal bests are always available under <a href="#/history">History</a>.</p>
      </div>
    </div>`;
    return;
  }

  el.innerHTML = html` <div class="page-head">
      <div>
        <h2 id="boards-title">Leaderboards</h2>
        <p>Only server-verified runs appear. Scores are recomputed on the server from raw keystrokes: score = net WPM x (accuracy / 100)^2. Minimum 90% accuracy to qualify.</p>
      </div>
    </div>
    <div class="modebar">
      <label class="sr-only" for="board-select">Board</label>
      <select id="board-select">
        ${raw(
          rankedBoards()
            .map((b) => html`<option value="${b}" ${b === state.board ? ' selected' : ''}>${b}</option>`)
            .join(''),
        )}
      </select>
      <div class="chips" role="group" aria-label="Period">
        ${raw(['daily', 'weekly', 'alltime'].map((p) => html`<button class="chip" type="button" data-period="${p}" aria-pressed="${p === state.period}">${p === 'alltime' ? 'all-time' : p}</button>`).join(''))}
      </div>
      <label class="sr-only" for="cohort-select">Scope</label>
      <select id="cohort-select">
        <option value="">global</option>
      </select>
    </div>
    <div class="cards">
      <div class="card wide">
        <div id="board-table"><p class="empty">Loading...</p></div>
      </div>
      <div class="card">
        <h3>Your handle</h3>
        <div class="field"><label for="handle">Shown on boards (3-24 chars)</label><input id="handle" maxlength="24" value="${app.store.get().handle}" /></div>
        <button class="btn" type="button" id="save-handle">Save handle</button>
      </div>
      <div class="card">
        <h3>Class / friends boards</h3>
        <div class="field"><label for="cohort-name">Create a cohort</label><input id="cohort-name" maxlength="40" placeholder="AWP Lab, Section B" /></div>
        <button class="btn" type="button" id="create-cohort">Create</button>
        <div class="field spaced"><label for="cohort-code">Join with invite code</label><input id="cohort-code" maxlength="6" autocapitalize="characters" /></div>
        <button class="btn" type="button" id="join-cohort">Join</button>
        <div id="cohort-list" class="hint-line"></div>
      </div>
      <div class="card wide">
        <h3>Personal board</h3>
        <div id="personal"><p class="empty">Loading...</p></div>
      </div>
    </div>`;

  const table = el.querySelector('#board-table');
  async function load() {
    try {
      const rows = await api.leaderboard({ board: state.board, period: state.period, cohort: state.cohort || null });
      table.innerHTML = rows.length
        ? html`<div class="table-wrap">
            <table class="data">
              <caption class="sr-only">
                ${state.board} ${state.period}
              </caption>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Typist</th>
                  <th class="num">Score</th>
                  <th class="num">Net WPM</th>
                  <th class="num">Accuracy</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                ${raw(
                  rows
                    .map(
                      (r) =>
                        html`<tr class="${r.is_me ? 'me' : ''}">
                          <td>${r.rank}</td>
                          <td>${r.handle}${r.is_me ? ' (you)' : ''}</td>
                          <td class="num">${fmt.n(Number(r.score), 1)}</td>
                          <td class="num">${fmt.n(Number(r.net_wpm))}</td>
                          <td class="num">${fmt.n(Number(r.accuracy), 1)}%</td>
                          <td>${fmt.day(r.created_at)}</td>
                        </tr>`,
                    )
                    .join(''),
                )}
              </tbody>
            </table>
          </div>`
        : '<p class="empty">No verified runs on this board for this period yet. Be the first.</p>';
    } catch (e) {
      table.innerHTML = html`<p class="empty">Could not load the board: ${e.message}</p>`;
    }
  }
  async function loadPersonal() {
    const box = el.querySelector('#personal');
    try {
      const p = await api.personal();
      const trend = (p.trend || []).map((t, i) => ({ x: i, y: Number(t.net_wpm) }));
      box.innerHTML = html`${raw(trend.length > 1 ? '<div class="chart-fit" data-chart="personal"></div>' : '')}${raw(
        p.bests && p.bests.length
          ? html`<div class="table-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th>Board</th>
                    <th class="num">Best score</th>
                    <th class="num">Net WPM</th>
                    <th class="num">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  ${raw(
                    p.bests
                      .map(
                        (b) =>
                          html`<tr>
                            <td>${b.board}</td>
                            <td class="num">${fmt.n(Number(b.score), 1)}</td>
                            <td class="num">${fmt.n(Number(b.net_wpm))}</td>
                            <td class="num">${fmt.n(Number(b.accuracy), 1)}%</td>
                          </tr>`,
                      )
                      .join(''),
                  )}
                </tbody>
              </table>
            </div>`
          : '<p class="empty">Submit a ranked run to start your personal board.</p>',
      )}`;
      fitChart(box.querySelector('[data-chart="personal"]'), (width) =>
        lineChart({ width, height: 200, title: '30-day trend', series: [{ points: trend }], xFormat: (x) => (p.trend[Math.round(x)] ? p.trend[Math.round(x)].day.slice(5) : ''), yLabel: 'wpm' }),
      );
    } catch (e) {
      box.innerHTML = html`<p class="empty">${e.message}</p>`;
    }
  }
  async function loadCohorts() {
    try {
      const cs = await api.myCohorts();
      const sel = el.querySelector('#cohort-select');
      sel.innerHTML = `<option value="">global</option>${cs.map((c) => html`<option value="${c.code}" ${c.code === state.cohort ? ' selected' : ''}>${c.name}</option>`).join('')}`;
      el.querySelector('#cohort-list').innerHTML = cs.length ? html`Your cohorts: ${cs.map((c) => `${c.name} (${c.code})`).join(', ')}` : '';
    } catch {
      /* optional */
    }
  }

  el.addEventListener('change', (e) => {
    if (e.target.id === 'board-select') state.board = e.target.value;
    if (e.target.id === 'cohort-select') state.cohort = e.target.value;
    load();
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.period) {
        state.period = b.dataset.period;
        for (const c of el.querySelectorAll('[data-period]')) c.setAttribute('aria-pressed', String(c === b));
        load();
      } else if (b.id === 'save-handle') {
        const h = el.querySelector('#handle').value.trim();
        await api.setHandle(h);
        app.store.set({ handle: h });
        toast('Handle saved.');
        load();
      } else if (b.id === 'create-cohort') {
        const c = await api.createCohort(el.querySelector('#cohort-name').value);
        toast(`Cohort created. Invite code: ${c.code}`, 6000);
        await loadCohorts();
      } else if (b.id === 'join-cohort') {
        const c = await api.joinCohort(el.querySelector('#cohort-code').value.trim().toUpperCase());
        toast(`Joined ${c.name}.`);
        await loadCohorts();
      }
    } catch (err) {
      toast(err.message || 'Request failed');
    }
  });

  channel = api.channel('leaderboard');
  channel.on('update', (p) => {
    if (!p.board || p.board === state.board) load();
  });
  await Promise.all([load(), loadPersonal(), loadCohorts()]);
  return () => channel && channel.leave();
}
