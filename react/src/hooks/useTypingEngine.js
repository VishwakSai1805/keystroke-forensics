/**
 * React binding for the shared core engine via useSyncExternalStore. The engine is the
 * single source of truth; React only subscribes to immutable snapshots.
 */
import { useMemo, useSyncExternalStore, useCallback, useRef, useEffect, useState } from 'react';
import { createEngine } from '@core/engine.js';

/**
 * @param {{modeId?:string, options?:Object, policy?:'free'|'strict'}} [config]
 * @returns {{engine:ReturnType<typeof createEngine>, snapshot:ReturnType<ReturnType<typeof createEngine>['getSnapshot']>, lastEvent:Object|null}}
 */
export function useTypingEngine(config) {
  const engine = useMemo(() => createEngine(config), []); // eslint-disable-line react-hooks/exhaustive-deps
  const lastEvent = useRef(null);
  const subscribe = useCallback(
    (onChange) =>
      engine.subscribe((ev) => {
        lastEvent.current = ev;
        onChange();
      }),
    [engine],
  );
  const snapshot = useSyncExternalStore(subscribe, engine.getSnapshot, engine.getSnapshot);
  return { engine, snapshot, lastEvent: lastEvent.current };
}

/** requestAnimationFrame-driven live metrics throttled to 10 Hz while running. */
export function useLiveMetrics(engine, running) {
  const [live, setLive] = useState(() => engine.live(performance.now()));
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const frame = (now) => {
      engine.tick(now);
      if (now - last >= 100) {
        last = now;
        setLive(engine.live(now));
      }
      if (engine.getSnapshot().status === 'RUNNING') raf = requestAnimationFrame(frame);
      else setLive(engine.live(now));
    };
    if (running) raf = requestAnimationFrame(frame);
    else setLive(engine.live(performance.now()));
    return () => cancelAnimationFrame(raf);
  }, [engine, running]);
  return live;
}
