/**
 * App settings and lightweight UI state, persisted per viewer in localStorage
 * (wrapped in try/catch: private windows can block storage).
 */
const KEY = 'kf:settings:v1';

export const DEFAULTS = Object.freeze({
  theme: 'auto',
  contrast: 'normal',
  font: 'mono',
  size: 'm',
  motion: 'system',
  layout: 'qwerty',
  sound: 'silent',
  haptics: false,
  policy: 'free',
  showKeyboard: false,
  showTelemetry: false,
  uiV2: true,
  coachFingers: false,
  handle: '',
  aiCoach: false,
  biometrics: false,
  keepLogs: true,
  goal: { wpm: 80, accuracy: 97 },
  modeId: 'sentence',
  modeOptions: {},
  ghost: false,
  ranked: true,
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw);
    // v2 UI: the keyboard heatmap and live-stats rail start hidden for everyone once.
    if (!saved.uiV2) Object.assign(saved, { showKeyboard: false, showTelemetry: false, uiV2: true });
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = load();
const listeners = new Set();

export const store = {
  get: () => settings,
  /** Merge a patch, persist, notify. */
  set(patch) {
    settings = { ...settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings live for this session only */
    }
    for (const fn of listeners) fn(settings, patch);
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  reset() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    settings = { ...DEFAULTS };
    for (const fn of listeners) fn(settings, settings);
  },
};

/** Apply visual settings to <html> data attributes (theme tokens swap via CSS). */
export function applyVisualSettings(s = settings) {
  const root = document.documentElement;
  if (s.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
  root.dataset.contrast = s.contrast;
  root.dataset.font = s.font;
  root.dataset.size = s.size;
  if (s.motion === 'system') delete root.dataset.motion;
  else root.dataset.motion = s.motion;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#0e0d0b');
}
