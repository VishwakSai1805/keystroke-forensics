import { useEffect, useRef, useState } from 'react';
import { buildReplayEvents, applyReplayEvent } from '@core/replay.js';
import { db } from '@client/db.js';
import { useTypingEngine } from '../hooks/useTypingEngine.js';
import { TypingField } from '../components/TypingField.jsx';

/** Replays a stored log through the same engine at 1x / 2x / 4x. */
export function ReplayView({ id }) {
  const [run, setRun] = useState(undefined);
  const { engine, snapshot } = useTypingEngine();
  const [vt, setVt] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const st = useRef({ idx: 0, events: [], t0: 0, total: 1 });
  const inputRef = useRef(null);

  const reset = (r) => {
    engine.configure({ modeId: r.modeId, options: r.options, policy: r.policy });
    engine.load({ seed: r.seed, text: r.customText });
    st.current.idx = 0;
  };
  useEffect(() => {
    db.get('runs', id).then((r) => {
      setRun(r || null);
      if (!r || !r.entries || !r.entries.length) return;
      const events = buildReplayEvents(r.entries);
      st.current = { idx: 0, events, t0: events[0].t, total: Math.max(1, events[events.length - 1].t - events[0].t) };
      reset(r);
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = (target) => {
    const s = st.current;
    while (s.idx < s.events.length && s.events[s.idx].t - s.t0 <= target) applyReplayEvent(engine, s.events[s.idx++]);
  };

  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = performance.now();
    let v = vt;
    const frame = (now) => {
      v = Math.min(st.current.total, v + (now - last) * speed);
      last = now;
      advance(v);
      setVt(v);
      if (v >= st.current.total) setPlaying(false);
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (run === undefined) return <p className="empty">Loading...</p>;
  if (!run || !run.entries)
    return (
      <div className="page-head">
        <div>
          <h2>Replay</h2>
          <p>No keystroke log stored for this run.</p>
        </div>
      </div>
    );
  const live = engine.live(st.current.t0 + vt);
  const seek = (target) => {
    setPlaying(false);
    if (target < vt) reset(run);
    advance(target);
    setVt(target);
  };
  return (
    <section className="view active">
      <div className="page-head">
        <div>
          <h2 id="replay-title">Replay</h2>
          <p>{run.boardKey} · rebuilt keystroke by keystroke</p>
        </div>
      </div>
      <div className="replay-bar">
        <button
          className="btn primary"
          type="button"
          onClick={() => {
            if (vt >= st.current.total) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="chips">
          {[1, 2, 4].map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="rp-seek">
          Position
        </label>
        <input id="rp-seek" type="range" min="0" max="1000" value={Math.round((vt / st.current.total) * 1000)} onChange={(e) => seek((Number(e.target.value) / 1000) * st.current.total)} />
        <span className="timer">{(vt / 1000).toFixed(1)}s</span>
      </div>
      <div className="stat-strip">
        <div>
          <span className="label">Net WPM</span>
          <div className="metric accent">{live.netWpm.toFixed(0)}</div>
        </div>
        <div>
          <span className="label">Keystrokes</span>
          <div className="metric">{live.keystrokes}</div>
        </div>
      </div>
      <TypingField snapshot={snapshot} ghostPos={null} inputRef={inputRef} onFocus={() => {}} />
    </section>
  );
}
