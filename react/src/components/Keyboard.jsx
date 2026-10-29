import { useEffect, useRef } from 'react';
import { mountKeyboard } from '@client/keyboard.js';

/** Wraps the framework-neutral keyboard heatmap from /client. */
export function Keyboard({ layout, heat, target }) {
  const ref = useRef(null);
  const kb = useRef(null);
  useEffect(() => {
    kb.current = mountKeyboard(ref.current, layout);
  }, [layout]);
  useEffect(() => {
    kb.current?.update(heat || {});
  }, [heat]);
  useEffect(() => {
    kb.current?.target(target ?? null);
  }, [target]);
  return <div ref={ref} />;
}
