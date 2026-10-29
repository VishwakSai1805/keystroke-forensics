/** Local history: runs table, personal bests, 30-day trend, weekly report, CSV/JSON export. */
import { lineChart } from '../../../client/charts.js';
import { getMode } from '../../../core/modes/index.js';
import { mean, round } from '../../../core/metrics.js';
import { db, listRuns } from '../../../client/db.js';
import { html, raw, fmt, download, toast } from '../dom.js';

const DAY = 86_400_000;

function weekly(runs, now) {
  const span = (from, to) => runs.filter((r) => r.createdAt >= from && r.createdAt < to);
  const thisWeek = span(now - 7 * DAY, now + 1);
  const lastWeek = span(now - 14 * DAY, now - 7 * DAY);
  const agg = (rs) => ({
    runs: rs.length,
    wpm: round(mean(rs.map((r) => r.result.netWpm))),
    acc: round(mean(rs.map((r) => r.result.finalAccuracy))),
    best: rs.length ? Math.max(...rs.map((r) => r.result.netWpm)) : 0,
    minutes: round(rs.reduce((a, r) => a + r.result.elapsedMs, 0) / 60000),
  });
  return { now: agg(thisWeek), prev: agg(lastWeek) };
}

const delta = (a, b, unit = '') => {
  if (!b) return '';
  const d = round(a - b);
  return ` (${d >= 0 ? '+' : ''}${d}${unit} vs last week)`;
};

/** CSV export (RFC 4180 quoting, formula-injection safe). */
export function toCsv(runs) {
  const cols = ['createdAt', 'modeId', 'boardKey', 'netWpm', 'grossWpm', 'finalAccuracy', 'rawAccuracy', 'consistency', 'burstWpm', 'score', 'elapsedMs', 'verification'];
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = runs.map((r) =>
    [
      new Date(r.createdAt).toISOString(),
      r.modeId,
      r.boardKey,
      r.result.netWpm,
      r.result.grossWpm,
      r.result.finalAccuracy,
      r.result.rawAccuracy,
      r.result.consistency,
      r.result.burstWpm,
      r.result.score,
      r.result.elapsedMs,
      r.verification,
    ]
      .map(cell)
      .join(','),
  );
  return [cols.join(','), ...rows].join('\n');
}

export async function mount(el) {
  const runs = await listRuns();
  const now = Date.now();
  const bests = {};
  for (const r of runs) if (!bests[r.boardKey] || r.result.score > bests[r.boardKey].result.score) bests[r.boardKey] = r;
  const trendMap = {};
  for (const r of runs) {
    if (r.createdAt < now - 30 * DAY) continue;
    const d = Math.floor((r.createdAt - (now - 30 * DAY)) / DAY);
    trendMap[d] = Math.max(trendMap[d] || 0, r.result.netWpm);
  }
  const trendPts = Object.entries(trendMap)
    .map(([d, v]) => ({ x: Number(d) * DAY, y: v }))
    .sort((a, b) => a.x - b.x);
  const w = weekly(runs, now);

  el.innerHTML = html` <div class="page-head">
      <div>
        <h2 id="history-title">History</h2>
        <p>Stored only in this browser (IndexedDB). Works offline.</p>
      </div>
      <div class="btn-row">
        <button class="btn" type="button" id="csv">Export CSV</button>
        <button class="btn" type="button" id="json">Export JSON</button>
        <button class="btn ghost" type="button" id="wipe">Delete all</button>
      </div>
    </div>
    <div class="stat-strip">
      <div>
        <span class="label">Runs this week</span>
        <div class="metric">${w.now.runs}</div>
        <span class="hint-line">${delta(w.now.runs, w.prev.runs)}</span>
      </div>
      <div>
        <span class="label">Avg net WPM</span>
        <div class="metric accent">${fmt.n(w.now.wpm)}</div>
        <span class="hint-line">${delta(w.now.wpm, w.prev.wpm)}</span>
      </div>
      <div>
        <span class="label">Avg accuracy</span>
        <div class="metric">${fmt.n(w.now.acc, 1)}<small>%</small></div>
        <span class="hint-line">${delta(w.now.acc, w.prev.acc, '%')}</span>
      </div>
      <div>
        <span class="label">Best this week</span>
        <div class="metric">${fmt.n(w.now.best)}</div>
      </div>
      <div>
        <span class="label">Practice time</span>
        <div class="metric">${fmt.n(w.now.minutes, 1)}<small>min</small></div>
      </div>
    </div>
    <div class="cards">
      <div class="card wide">
        <h3>30-day trend (best net WPM per day)</h3>
        ${raw(trendPts.length > 1 ? lineChart({ title: '30-day trend', series: [{ points: trendPts }], xFormat: (x) => `-${30 - Math.round(x / DAY)}d`, yLabel: 'wpm' }) : '<p class="empty">Practise on two different days to see a trend.</p>')}
      </div>
      <div class="card wide">
        <h3>Personal bests</h3>
        ${raw(
          Object.keys(bests).length
            ? html`<div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th>Board</th>
                      <th class="num">Net WPM</th>
                      <th class="num">Accuracy</th>
                      <th class="num">Score</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${raw(
                      Object.values(bests)
                        .sort((a, b) => a.boardKey.localeCompare(b.boardKey))
                        .map(
                          (r) =>
                            html`<tr>
                              <td><a href="#/report/${r.id}">${r.boardKey}</a></td>
                              <td class="num">${fmt.n(r.result.netWpm)}</td>
                              <td class="num">${fmt.n(r.result.finalAccuracy, 1)}%</td>
                              <td class="num">${fmt.n(r.result.score, 1)}</td>
                              <td>${fmt.day(r.createdAt)}</td>
                            </tr>`,
                        )
                        .join(''),
                    )}
                  </tbody>
                </table>
              </div>`
            : '<p class="empty">No runs yet.</p>',
        )}
      </div>
    </div>
    <h3 class="section">All runs</h3>
    ${raw(
      runs.length
        ? html`<div class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Mode</th>
                  <th class="num">Net</th>
                  <th class="num">Acc</th>
                  <th class="num">Cons.</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${raw(
                  runs
                    .slice(0, 300)
                    .map(
                      (r) =>
                        html`<tr>
                          <td>${fmt.date(r.createdAt)}</td>
                          <td>${getMode(r.modeId).label} <span class="hint-line">${r.boardKey}</span></td>
                          <td class="num">${fmt.n(r.result.netWpm)}</td>
                          <td class="num">${fmt.n(r.result.finalAccuracy, 1)}%</td>
                          <td class="num">${fmt.n(r.result.consistency)}%</td>
                          <td>${r.verification}</td>
                          <td><a href="#/report/${r.id}">report</a>${raw(r.entries ? html` · <a href="#/replay/${r.id}">replay</a>` : '')}</td>
                        </tr>`,
                    )
                    .join(''),
                )}
              </tbody>
            </table>
          </div>`
        : '<p class="empty">Nothing recorded yet.</p>',
    )}`;

  const stripLogs = (r) => ({ ...r, entries: undefined });
  el.querySelector('#csv').onclick = () => download('keystroke-forensics-history.csv', toCsv(runs), 'text/csv');
  el.querySelector('#json').onclick = () => download('keystroke-forensics-history.json', JSON.stringify(runs.map(stripLogs), null, 2), 'application/json');
  el.querySelector('#wipe').onclick = async () => {
    if (!confirm('Delete every run stored in this browser? This cannot be undone.')) return;
    await db.clear('runs');
    toast('Local history deleted.');
    mount(el);
  };
}
