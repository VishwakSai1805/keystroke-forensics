import { useEffect, useState } from 'react';
import { lineChart, barChart } from '@client/charts.js';
import { renderShareCard, shareCard } from '@client/shareCard.js';
import { db, listRuns } from '@client/db.js';
import { getMode } from '@core/modes/index.js';
import { Svg } from '../components/Svg.jsx';
import { Keyboard } from '../components/Keyboard.jsx';

const n = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '--');

export function ReportView({ id, settings }) {
  const [run, setRun] = useState(undefined);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = id ? await db.get('runs', id) : (await listRuns())[0];
      if (alive) setRun(r || null);
    };
    load();
    const t = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  if (run === undefined) return <p className="empty">Loading...</p>;
  if (!run)
    return (
      <div className="page-head">
        <div>
          <h2>Report</h2>
          <p>No runs yet.</p>
        </div>
        <a className="btn primary" href="#/">
          Start typing
        </a>
      </div>
    );
  const r = run.result;
  const a = run.analysis;
  const series = (a && a.series) || [];
  const chart = series.length
    ? lineChart({
        title: 'WPM over time',
        series: [{ points: series.map((p) => ({ x: p.t, y: p.wpm })) }, { points: series.map((p) => ({ x: p.t, y: p.cum })), cls: 'alt' }],
        ticks: (a.errors || []).map((e) => e.t),
        bands: (a.flow && a.flow.segments) || [],
        yLabel: 'wpm',
      })
    : '<p class="empty">Not enough data.</p>';
  const share = async () => {
    const url = `${location.origin}/react/#/`;
    await shareCard(await renderShareCard({ ...r, verified: run.verification === 'submitted' }, url), { title: 'Keystroke Forensics', text: `${Math.round(r.netWpm)} WPM`, url });
  };
  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h2 id="report-title">Run report</h2>
          <p>
            {getMode(run.modeId).label} · {run.boardKey} · {new Date(run.createdAt).toLocaleString()} · <span id="verify-state">{run.verification}</span>
          </p>
        </div>
        <div className="btn-row">
          {run.entries && (
            <a className="btn" href={`#/replay/${run.id}`}>
              Replay
            </a>
          )}
          <button className="btn" type="button" onClick={share}>
            Share card
          </button>
          <a className="btn primary" href="#/">
            Next run
          </a>
        </div>
      </div>
      <div className="stat-strip">
        <div>
          <span className="label">Net WPM</span>
          <div className="metric accent">{n(r.netWpm)}</div>
        </div>
        <div>
          <span className="label">Gross WPM</span>
          <div className="metric">{n(r.grossWpm)}</div>
        </div>
        <div>
          <span className="label">Final accuracy</span>
          <div className="metric">
            {n(r.finalAccuracy, 1)}
            <small>%</small>
          </div>
        </div>
        <div>
          <span className="label">Raw accuracy</span>
          <div className="metric">
            {n(r.rawAccuracy, 1)}
            <small>%</small>
          </div>
        </div>
        <div>
          <span className="label">Consistency</span>
          <div className="metric">
            {n(r.consistency)}
            <small>%</small>
          </div>
        </div>
        <div>
          <span className="label">Burst 5 s</span>
          <div className="metric">{n(r.burstWpm)}</div>
        </div>
        <div>
          <span className="label">Score</span>
          <div className="metric">{n(r.score, 1)}</div>
        </div>
      </div>
      {a && <p className="diagnosis">{a.diagnosis}</p>}
      <div className="cards">
        <div className="card wide">
          <h3>WPM over time</h3>
          <Svg markup={chart} />
        </div>
        {a && a.fatigue && (
          <div className="card">
            <h3>Fatigue curve</h3>
            <div className="rail-row">
              <span>First half</span>
              <span>{n(a.fatigue.firstHalf)} wpm</span>
            </div>
            <div className="rail-row">
              <span>Second half</span>
              <span>{n(a.fatigue.secondHalf)} wpm</span>
            </div>
            <div className="rail-row">
              <span>Change</span>
              <span>{n(a.fatigue.changePct, 1)}%</span>
            </div>
          </div>
        )}
        {a && (
          <div className="card">
            <h3>Slowest bigrams</h3>
            <Svg
              markup={
                a.slowest.length ? barChart({ items: a.slowest.map((b) => ({ label: `'${b.bigram}'`, value: b.meanLatency, note: `(+${b.slowdownPct}%)` })), unit: 'ms' }) : '<p class="empty">--</p>'
              }
            />
          </div>
        )}
        {a && (
          <div className="card">
            <h3>Finger load</h3>
            <Svg markup={barChart({ items: a.fingers.filter((f) => f.count).map((f) => ({ label: f.finger, value: f.load, note: f.errors ? `${f.errorRate}% err` : '' })), unit: '%' })} />
          </div>
        )}
        {a && (
          <div className="card">
            <h3>Keyboard heatmap</h3>
            <Keyboard layout={settings.layout} heat={a.heat} />
          </div>
        )}
      </div>
    </section>
  );
}
