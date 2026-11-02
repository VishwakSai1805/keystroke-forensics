/** Tiny DOM helpers shared by the vanilla views. */
import { escapeHtml } from '../../core/sanitize.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = escapeHtml;

/**
 * Tagged template that escapes interpolations unless wrapped with raw().
 * @returns {string}
 */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v && v.__raw) out += v.value;
      else if (Array.isArray(v)) out += v.map((x) => (x && x.__raw ? x.value : esc(String(x ?? '')))).join('');
      else out += esc(String(v ?? ''));
    }
  });
  return out;
}

/** Mark a string as trusted markup for html``. */
export const raw = (value) => ({ __raw: true, value: String(value) });

/** Render trusted markup into an element. */
export function render(el, markup) {
  el.innerHTML = markup;
  return el;
}

let toastTimer = null;
/** Show a transient status message (announced politely). */
export function toast(msg, ms = 3200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const fmt = {
  n: (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '--'),
  pct: (x) => (Number.isFinite(x) ? `${x.toFixed(1)}%` : '--'),
  secs: (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '--'),
  date: (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  day: (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
};

/** Local calendar day (YYYY-MM-DD) for streaks. */
export function localDay(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Trigger a file download for generated content. */
export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Respect both the OS setting and the in-app override. */
export function reducedMotion() {
  return document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Number-roll animation for final results (skipped under reduced motion).
 * @param {HTMLElement} el Target.
 * @param {number} to Final value.
 * @param {number} [decimals=0]
 */
export function rollNumber(el, to, decimals = 0) {
  if (!el) return;
  if (reducedMotion() || !Number.isFinite(to)) {
    el.textContent = fmt.n(to, decimals);
    return;
  }
  const start = performance.now();
  const dur = 700;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = (to * eased).toFixed(decimals);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Draw an SVG chart at the container's real pixel width (so chart text is a normal size
 * instead of being scaled with the viewBox) and redraw when the width changes.
 * @param {HTMLElement|null} el Container.
 * @param {(width:number)=>string} build Returns chart markup for a width.
 * @returns {()=>void} Stop watching.
 */
export function fitChart(el, build) {
  if (!el) return () => {};
  let last = 0;
  const draw = () => {
    const w = Math.round(el.clientWidth);
    if (w > 0 && Math.abs(w - last) > 4) {
      last = w;
      el.innerHTML = build(w);
    }
  };
  draw();
  if (typeof ResizeObserver !== 'function') return () => {};
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  ro.observe(el);
  return () => ro.disconnect();
}
