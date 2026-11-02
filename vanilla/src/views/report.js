/** Post-run report: charts, diagnosis, bigrams, fingers, heatmap, errors, share card. */
import { lineChart, barChart } from '../../../client/charts.js';
import { mountKeyboard } from '../../../client/keyboard.js';
import { renderShareCard, shareCard } from '../../../client/shareCard.js';
import { getMode } from '../../../core/modes/index.js';
import { db, listRuns } from '../../../client/db.js';
import { html, raw, fmt, toast, download, rollNumber, fitChart } from '../dom.js';

const VERIFY_LABEL = { local: 'local only', pending: 'submitting...', submitted: 'submitted · server-verified', unqualified: 'recorded · below leaderboard bar', rejected: 'not accepted by server' };

export async function mount(el, app, [id]) {
  const run = id ? await db.get('runs', id) : (await listRuns())[0];
  if (!run) {
    el.innerHTML = html`<div class="page-head">
      <div>
        <h2 id="report-title">Report</h2>
        <p>No runs yet. Finish a test and the full forensic report appears here.</p>
      </div>
      <a class="btn primary" href="#/">Start typing</a>
    </div>`;
    return;
  }
  const r = run.result;
  const a = run.analysis;
  const mode = getMode(run.modeId);
  const extras = r.extras || {};
  const extraCells = [
    extras.cliSpeed !== undefined
      ? html`<div>
          <span class="label">CLI speed</span>
          <div class="metric">${fmt.n(extras.cliSpeed, 1)}<small>cmd/min</small></div>
        </div>`
      : '',
    extras.detectionAccuracy !== undefined
      ? html`<div>
          <span class="label">Detection</span>
          <div class="metric accent">${fmt.n(extras.detectionAccuracy, 1)}<small>%</small></div>
        </div>`
      : '',
  ].join('');

  const series = a && a.series ? a.series : [];
  const chart = (width) =>
    lineChart({
      width,
      height: Math.max(180, Math.min(280, Math.round(width * 0.32))),
      title: 'WPM over time',
      series: [
        { points: series.map((p) => ({ x: p.t, y: p.wpm })), cls: '' },
        { points: series.map((p) => ({ x: p.t, y: p.cum })), cls: 'alt' },
      ],
      ticks: (a.errors || []).map((e) => e.t),
      bands: (a.flow && a.flow.segments) || [],
      yLabel: 'wpm',
    });

  const hasSlow = Boolean(a && a.slowest && a.slowest.length);
  const slow = (width) => barChart({ width, title: 'Slowest bigrams', items: a.slowest.map((b) => ({ label: `'${b.bigram}'`, value: b.meanLatency, note: `(+${b.slowdownPct}%)` })), unit: 'ms' });
  const fingers = a && a.fingers ? a.fingers.filter((f) => f.count > 0) : [];
  const fingerChart = (width) => barChart({ width, title: 'Finger load', items: fingers.map((f) => ({ label: f.finger, value: f.load, note: f.errors ? `${f.errorRate}% err` : '' })), unit: '%' });
  const errors = (a && a.errors) || [];
  const fat = a && a.fatigue;

  const phishing = run.phishing
    ? html`<div class="card">
        <h3>Phishing debrief</h3>
        <ol class="url-list">
          ${raw(
            run.phishing
              .map((p) => {
                const right = (p.decision === 'flag') === p.suspicious;
                return html`<li class="${right ? 'right' : 'wrong'}">
                  <div>
                    ${p.url}
                    <div class="hint-line">${p.flags.join(' · ')}</div>
                  </div>
                  <span class="verdict">${p.decision === 'flag' ? 'flagged' : 'safe'} · ${p.suspicious ? 'suspicious' : 'legitimate'}</span>
                </li>`;
              })
              .join(''),
          )}
        </ol>
      </div>`
    : '';

  el.innerHTML = html` <div class="page-head">
      <div>
        <h2 id="report-title">Run report</h2>
        <p>
          ${mode.label} · ${run.boardKey} · ${fmt.date(run.createdAt)} ·
          <span id="verify-state">${VERIFY_LABEL[run.verification] || run.verification}</span>${r.failed ? ' · ended by sudden death' : ''}
        </p>
      </div>
      <div class="btn-row">
        ${raw(run.entries ? html`<a class="btn" href="#/replay/${run.id}">Replay</a>` : '')}
        <button class="btn" type="button" id="share">Share card</button>
        <button class="btn ghost" type="button" id="export">Export JSON</button>
        <a class="btn primary" href="#/">Next run</a>
      </div>
    </div>
    <div class="stat-strip">
      <div>
        <span class="label">Net WPM</span>
        <div class="metric accent" id="roll-net">${fmt.n(r.netWpm)}</div>
      </div>
      <div>
        <span class="label">Accuracy</span>
        <div class="metric">${fmt.n(r.finalAccuracy, 1)}<small>%</small></div>
      </div>
      <div>
        <span class="label">Consistency</span>
        <div class="metric">${fmt.n(r.consistency)}<small>%</small></div>
      </div>
      <div>
        <span class="label">Time</span>
        <div class="metric">${fmt.n(r.elapsedMs / 1000, 1)}<small>s</small></div>
      </div>
      ${raw(extraCells)}
    </div>
    <details class="more-stats">
      <summary>All metrics</summary>
      <div class="stat-strip">
        <div>
          <span class="label">Gross WPM</span>
          <div class="metric">${fmt.n(r.grossWpm)}</div>
        </div>
        <div>
          <span class="label">Raw accuracy</span>
          <div class="metric">${fmt.n(r.rawAccuracy, 1)}<small>%</small></div>
        </div>
        <div>
          <span class="label">Burst 5 s</span>
          <div class="metric">${fmt.n(r.burstWpm)}</div>
        </div>
        <div>
          <span class="label">Score</span>
          <div class="metric">${fmt.n(r.score, 1)}</div>
        </div>
      </div>
    </details>
    ${raw(a ? html`<p class="diagnosis">${a.diagnosis}</p>` : '')}
    <div class="cards">
      <div class="card wide">
        <h3>WPM over time</h3>
        <p class="hint-line">Solid: rolling 2 s WPM · dashed: cumulative · ticks: errors · shaded: flow state${a && a.flow ? ` (${a.flow.flowPct}% of the run)` : ''}</p>
        ${raw(series.length ? '<div class="chart-fit" data-chart="wpm"></div>' : '<p class="empty">Not enough data for a time series.</p>')}
      </div>
      <div class="card">
        <h3>Fatigue curve</h3>
        ${raw(
          fat
            ? html`<div class="rail-row"><span>First half</span><span>${fmt.n(fat.firstHalf)} wpm</span></div>
                <div class="rail-row"><span>Second half</span><span>${fmt.n(fat.secondHalf)} wpm</span></div>
                <div class="rail-row"><span>Change</span><span>${fat.changePct > 0 ? '+' : ''}${fmt.n(fat.changePct, 1)}%</span></div>
                <div class="rail-row"><span>Slope</span><span>${fmt.n(fat.slopePerMin, 1)} wpm/min</span></div>`
            : '<p class="empty">--</p>',
        )}
      </div>
      <div class="card">
        <h3>Slowest bigrams</h3>
        ${raw(hasSlow ? '<div class="chart-fit" data-chart="slow"></div>' : '<p class="empty">No repeated letter pairs yet.</p>')}
      </div>
      <div class="card">
        <h3>Finger load</h3>
        ${raw(fingers.length ? '<div class="chart-fit" data-chart="fingers"></div>' : '<p class="empty">No finger data.</p>')}
      </div>
      <div class="card">
        <h3>Keyboard heatmap</h3>
        <div id="report-kb"></div>
      </div>
      <div class="card">
        <h3>Error timeline</h3>
        ${raw(
          errors.length
            ? html`<div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Expected</th>
                      <th>Typed</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${raw(
                      errors
                        .slice(0, 25)
                        .map(
                          (e) =>
                            html`<tr>
                              <td>${fmt.secs(e.t)}</td>
                              <td>${e.expected}</td>
                              <td>${e.got}</td>
                            </tr>`,
                        )
                        .join(''),
                    )}
                  </tbody>
                </table>
              </div>`
            : '<p class="empty">No errors. Clean run.</p>',
        )}
      </div>
      ${raw(phishing)}
    </div>`;

  const stopCharts = [
    series.length ? fitChart(el.querySelector('[data-chart="wpm"]'), chart) : null,
    hasSlow ? fitChart(el.querySelector('[data-chart="slow"]'), slow) : null,
    fingers.length ? fitChart(el.querySelector('[data-chart="fingers"]'), fingerChart) : null,
  ].filter(Boolean);
  rollNumber(el.querySelector('#roll-net'), r.netWpm, 0);
  if (a && a.heat) {
    const kb = mountKeyboard(el.querySelector('#report-kb'), app.store.get().layout);
    kb.update(a.heat);
  }
  el.querySelector('#export').onclick = () => download(`run-${run.id}.json`, JSON.stringify(run, null, 2), 'application/json');
  el.querySelector('#share').onclick = async () => {
    const url = `${location.origin}${location.pathname}#/`;
    const blob = await renderShareCard({ ...r, verified: run.verification === 'submitted' }, url);
    const how = await shareCard(blob, { title: 'Keystroke Forensics', text: `${Math.round(r.netWpm)} WPM at ${r.finalAccuracy}% on ${run.boardKey}`, url });
    if (how === 'downloaded') toast('Result card downloaded.');
  };
  const timer = setInterval(async () => {
    const fresh = await db.get('runs', run.id);
    const s = el.querySelector('#verify-state');
    if (fresh && s) s.textContent = VERIFY_LABEL[fresh.verification] || fresh.verification;
    if (!fresh || fresh.verification !== 'pending') clearInterval(timer);
  }, 1000);
  return () => {
    clearInterval(timer);
    for (const stop of stopCharts) stop();
  };
}
