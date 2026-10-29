/**
 * Hand-drawn SVG chart builders (no chart library). Pure string output so the vanilla and
 * React front-ends render identical charts. All text is escaped.
 * @module client/charts
 */
import { escapeHtml as esc } from '../core/sanitize.js';

const f = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

/**
 * Sparkline path data for a series of values.
 * @param {number[]} values Values.
 * @param {{width?:number, height?:number, min?:number, max?:number}} [o]
 * @returns {{line:string, area:string}}
 */
export function sparklinePaths(values, o = {}) {
  const w = o.width ?? 260;
  const h = o.height ?? 64;
  if (values.length < 2) return { line: '', area: '' };
  const max = Math.max(o.max ?? 0, ...values, 1);
  const min = o.min ?? 0;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 4) - 2]);
  const line = 'M' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L');
  return { line, area: `${line}L${w},${h}L0,${h}Z` };
}

/**
 * Full sparkline SVG inner markup.
 * @param {number[]} values Values.
 * @returns {string}
 */
export function sparklineSvg(values, o = {}) {
  const { line, area } = sparklinePaths(values, o);
  const h = o.height ?? 64;
  return `<line class="base" x1="0" x2="${o.width ?? 260}" y1="${h}" y2="${h}"/>${line ? `<path class="area" d="${area}"/><path class="line" d="${line}"/>` : ''}`;
}

/**
 * Line chart with axes, optional error ticks and highlighted bands.
 * @param {{series:{points:{x:number,y:number}[], cls?:string, label?:string}[], width?:number, height?:number, xLabel?:string, yLabel?:string, ticks?:number[], bands?:{from:number,to:number}[], xFormat?:(x:number)=>string, title?:string}} o
 * @returns {string} Complete <svg> markup.
 */
export function lineChart(o) {
  const W = o.width ?? 640;
  const H = o.height ?? 220;
  const m = { l: 40, r: 12, t: 12, b: 30 };
  const all = o.series.flatMap((s) => s.points);
  const xMax = Math.max(1, ...all.map((p) => p.x));
  const yMax = Math.max(10, ...all.map((p) => p.y)) * 1.1;
  const X = (x) => m.l + (x / xMax) * (W - m.l - m.r);
  const Y = (y) => H - m.b - (y / yMax) * (H - m.t - m.b);
  const xf = o.xFormat || ((x) => `${Math.round(x / 1000)}s`);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Chart')}">`;
  for (let i = 0; i <= 4; i++) {
    const y = (yMax / 4) * i;
    s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${f(Y(y))}" y2="${f(Y(y))}"/><text x="${m.l - 6}" y="${f(Y(y)) + 3}" text-anchor="end">${Math.round(y)}</text>`;
  }
  for (let i = 0; i <= 5; i++) {
    const x = (xMax / 5) * i;
    s += `<text x="${f(X(x))}" y="${H - 10}" text-anchor="middle">${esc(xf(x))}</text>`;
  }
  for (const b of o.bands || []) s += `<rect class="flow" x="${f(X(b.from))}" y="${m.t}" width="${f(Math.max(1, X(b.to) - X(b.from)))}" height="${H - m.t - m.b}"/>`;
  for (const t of o.ticks || []) s += `<line class="err" x1="${f(X(t))}" x2="${f(X(t))}" y1="${H - m.b}" y2="${H - m.b - 8}"/>`;
  s += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
  for (const ser of o.series) {
    if (ser.points.length < 2) continue;
    s += `<path class="series ${esc(ser.cls || '')}" d="M${ser.points.map((p) => `${f(X(p.x))},${f(Y(p.y))}`).join('L')}"/>`;
  }
  if (o.yLabel) s += `<text x="${m.l + 6}" y="${m.t + 12}">${esc(o.yLabel)}</text>`;
  return `${s}</svg>`;
}

/**
 * Horizontal bar chart.
 * @param {{items:{label:string, value:number, note?:string, alt?:boolean}[], width?:number, unit?:string, title?:string, max?:number}} o
 * @returns {string}
 */
export function barChart(o) {
  const W = o.width ?? 420;
  const row = 22;
  const H = Math.max(row, o.items.length * row) + 4;
  const labelW = 70;
  const max = o.max ?? Math.max(1, ...o.items.map((i) => i.value));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Bar chart')}">`;
  o.items.forEach((it, i) => {
    const y = i * row + 4;
    const w = (Math.max(0, it.value) / max) * (W - labelW - 70);
    s += `<text x="0" y="${y + 12}">${esc(it.label)}</text><rect class="bar${it.alt ? ' alt' : ''}" x="${labelW}" y="${y + 3}" width="${f(w)}" height="11"/><text x="${f(labelW + w + 6)}" y="${y + 12}">${esc(`${f(it.value)}${o.unit || ''}${it.note ? ` ${it.note}` : ''}`)}</text>`;
  });
  return `${s}</svg>`;
}

/**
 * ROC curve (FAR on x, TPR on y) with the diagonal and the EER point.
 * @param {{roc:{far:number,tpr:number}[], eer:number}} ev Evaluation.
 * @returns {string}
 */
export function rocChart(ev) {
  const W = 300;
  const H = 260;
  const m = { l: 36, r: 10, t: 10, b: 30 };
  const X = (x) => m.l + x * (W - m.l - m.r);
  const Y = (y) => H - m.b - y * (H - m.t - m.b);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="ROC curve, equal error rate ${esc(String(ev.eer))} percent">`;
  for (let i = 0; i <= 4; i++) {
    const v = i / 4;
    s += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text x="${m.l - 4}" y="${f(Y(v)) + 3}" text-anchor="end">${v}</text><text x="${f(X(v))}" y="${H - 12}" text-anchor="middle">${v}</text>`;
  }
  s += `<path class="series alt" d="M${X(0)},${Y(0)}L${X(1)},${Y(1)}"/>`;
  const pts = ev.roc.slice().sort((a, b) => a.far - b.far || a.tpr - b.tpr);
  if (pts.length > 1) s += `<path class="series" d="M${pts.map((p) => `${f(X(p.far))},${f(Y(p.tpr))}`).join('L')}"/>`;
  s += `<text x="${m.l + 6}" y="${m.t + 12}">EER ${esc(String(ev.eer))}%</text><text x="${W - m.r}" y="${H - 1}" text-anchor="end">FAR</text><text x="2" y="${m.t + 30}">TPR</text></svg>`;
  return s;
}

/**
 * Progress ring.
 * @param {number} pct 0..100.
 * @param {{alt?:boolean, label?:string}} [o]
 * @returns {string}
 */
export function progressRing(pct, o = {}) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `<svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${esc(o.label || `${Math.round(pct)}%`)}"><circle class="track" cx="42" cy="42" r="${r}"/><circle class="val${o.alt ? ' alt' : ''}" cx="42" cy="42" r="${r}" stroke-dasharray="${f(c)}" stroke-dashoffset="${f(off)}"/><text x="42" y="47" text-anchor="middle" fill="currentColor" font-size="14">${Math.round(pct)}%</text></svg>`;
}
