import { useEffect, useState } from 'react';
import { listRuns } from '@client/db.js';
import { lineChart } from '@client/charts.js';
import { Svg } from '../components/Svg.jsx';

const DAY = 86_400_000;

export function HistoryView() {
  const [runs, setRuns] = useState(null);
  useEffect(() => {
    listRuns().then(setRuns);
  }, []);
  if (!runs) return <p className="empty">Loading...</p>;
  const now = Date.now();
  const best = {};
  for (const r of runs) {
    if (r.createdAt < now - 30 * DAY) continue;
    const d = Math.floor((r.createdAt - (now - 30 * DAY)) / DAY);
    best[d] = Math.max(best[d] || 0, r.result.netWpm);
  }
  const pts = Object.entries(best)
    .map(([d, v]) => ({ x: Number(d) * DAY, y: v }))
    .sort((a, b) => a.x - b.x);
  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h2 id="history-title">History</h2>
          <p>Shared with the vanilla front-end (same IndexedDB on this origin).</p>
        </div>
      </div>
      <div className="cards">
        <div className="card wide">
          <h3>30-day trend</h3>
          {pts.length > 1 ? (
            <Svg markup={lineChart({ series: [{ points: pts }], xFormat: (x) => `-${30 - Math.round(x / DAY)}d`, yLabel: 'wpm' })} />
          ) : (
            <p className="empty">Practise on two days to see a trend.</p>
          )}
        </div>
      </div>
      <h3 className="section">All runs</h3>
      {runs.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Board</th>
                <th className="num">Net</th>
                <th className="num">Acc</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 300).map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{r.boardKey}</td>
                  <td className="num">{r.result.netWpm.toFixed(0)}</td>
                  <td className="num">{r.result.finalAccuracy.toFixed(1)}%</td>
                  <td>{r.verification}</td>
                  <td>
                    <a href={`#/report/${r.id}`}>report</a>
                    {r.entries && (
                      <>
                        {' '}
                        · <a href={`#/replay/${r.id}`}>replay</a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Nothing recorded yet.</p>
      )}
    </section>
  );
}
