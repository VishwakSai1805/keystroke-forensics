import { useEffect, useState, useCallback } from 'react';

const BOARDS = [
  'timed:15',
  'timed:30',
  'timed:60',
  'timed:120',
  'words:10',
  'words:25',
  'words:50',
  'words:100',
  'sentence',
  'quote:short',
  'quote:medium',
  'quote:long',
  'code:javascript',
  'code:python',
  'code:c',
  'code:sql',
  'punctuation:25',
  'blind',
  'sudden',
  'command:all',
  'logs:siem',
];

export function BoardsView({ api }) {
  const [board, setBoard] = useState('timed:30');
  const [period, setPeriod] = useState('daily');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setRows(await api.leaderboard({ board, period }));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [api, board, period]);
  useEffect(() => {
    if (!api.online) return undefined;
    load();
    const ch = api.channel('leaderboard');
    ch.on('update', (p) => (!p.board || p.board === board) && load());
    return () => ch.leave();
  }, [api, load, board]);

  if (!api.online)
    return (
      <section className="view active">
        <div className="page-head">
          <div>
            <h2>Leaderboards</h2>
            <p>Offline: the leaderboard needs the backend.</p>
          </div>
        </div>
      </section>
    );
  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h2 id="boards-title">Leaderboards</h2>
          <p>Server-verified runs only. Score = net WPM x (accuracy/100)^2.</p>
        </div>
      </div>
      <div className="modebar">
        <label className="sr-only" htmlFor="board-select">
          Board
        </label>
        <select id="board-select" value={board} onChange={(e) => setBoard(e.target.value)}>
          {BOARDS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <div className="chips">
          {['daily', 'weekly', 'alltime'].map((p) => (
            <button key={p} type="button" className="chip" aria-pressed={p === period} onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="empty">{error}</p>}
      {rows && rows.length === 0 && <p className="empty">No verified runs yet.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Typist</th>
                <th className="num">Score</th>
                <th className="num">Net WPM</th>
                <th className="num">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rank} className={r.is_me ? 'me' : ''}>
                  <td>{r.rank}</td>
                  <td>
                    {r.handle}
                    {r.is_me ? ' (you)' : ''}
                  </td>
                  <td className="num">{Number(r.score).toFixed(1)}</td>
                  <td className="num">{Number(r.net_wpm).toFixed(0)}</td>
                  <td className="num">{Number(r.accuracy).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
