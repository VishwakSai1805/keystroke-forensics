import { memo } from 'react';
import { sparklinePaths } from '@client/charts.js';

/** Hand-drawn SVG sparkline (no chart library). */
export const Sparkline = memo(function Sparkline({ values }) {
  const { line, area } = sparklinePaths(values.slice(-120), { width: 260, height: 64, max: 60 });
  return (
    <svg className="spark" viewBox="0 0 260 64" preserveAspectRatio="none" role="img" aria-label="Live WPM sparkline">
      <line className="base" x1="0" x2="260" y1="64" y2="64" />
      {line && <path className="area" d={area} />}
      {line && <path className="line" d={line} />}
    </svg>
  );
});
