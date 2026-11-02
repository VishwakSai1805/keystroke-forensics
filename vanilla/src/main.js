/**
 * Vanilla front-end bootstrap: settings, backend detection, analytics worker, controller,
 * hash router, global shortcuts, service worker and install prompt.
 */
import { store, applyVisualSettings } from '../../client/store.js';
import { createApi } from '../../client/api.js';
import { createAnalytics } from '../../client/analytics.js';
import { createController } from './typing/controller.js';
import { mountModebar } from './views/modebar.js';
import { $, $$ } from './dom.js';

applyVisualSettings(store.get());
store.subscribe((s) => applyVisualSettings(s));

const api = createApi(window.KF_CONFIG || {});
const analytics = createAnalytics(new URL('../../client/analytics.worker.js', import.meta.url));

const VIEWS = {
  report: () => import('./views/report.js'),
  history: () => import('./views/history.js'),
  boards: () => import('./views/boards.js'),
  duel: () => import('./views/duel.js'),
  learn: () => import('./views/learn.js'),
  biometrics: () => import('./views/biometrics.js'),
  settings: () => import('./views/settings.js'),
  replay: () => import('./views/replay.js'),
};

const app = {
  api,
  analytics,
  store,
  controller: null,
  modebar: null,
  lastRecord: null,
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
};

app.controller = createController({
  api,
  analytics,
  store,
  onComplete(record) {
    app.lastRecord = record;
    showResultLink(record);
  },
});
app.modebar = mountModebar($('#modebar'), app);

function showResultLink(record) {
  const meta = $('#typing-meta-right');
  const a = document.createElement('a');
  a.href = `#/report/${record.id}`;
  a.textContent = 'Full report ->';
  a.id = 'report-link';
  meta.replaceChildren(a);
}

let currentCleanup = null;

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'test';
  const viewName = VIEWS[name] ? name : 'test';
  for (const v of $$('.view')) v.classList.toggle('active', v.dataset.view === viewName);
  for (const a of $$('.nav a')) {
    const target = a.getAttribute('href').replace(/^#\/?/, '') || 'test';
    if (target === viewName || ((viewName === 'replay' || viewName === 'report') && target === 'history')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  // "More" menu: close after navigating, and highlight it when one of its pages is open.
  const more = $('#nav-more');
  more.open = false;
  more.classList.toggle('has-current', Boolean(more.querySelector('[aria-current]')));
  if (currentCleanup) {
    try {
      currentCleanup();
    } catch {
      /* ignore */
    }
    currentCleanup = null;
  }
  document.title = viewName === 'test' ? 'Keystroke Forensics' : `${viewName[0].toUpperCase()}${viewName.slice(1)} - Keystroke Forensics`;
  if (viewName === 'test') {
    if (app.controller.engine.getSnapshot().status === 'IDLE') await app.controller.start();
    app.controller.focus();
    return;
  }
  const el = $(`.view[data-view="${viewName}"]`);
  const mod = await VIEWS[viewName]();
  currentCleanup = (await mod.mount(el, app, parts.slice(1))) || null;
  const h = el.querySelector('h2');
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
}

// Global shortcuts: typing anywhere on the test view focuses the field without losing the key.
document.addEventListener('keydown', (e) => {
  const onTest = $('.view[data-view="test"]').classList.contains('active');
  const t = e.target;
  const inField = t && (t.closest('input, textarea, select, [contenteditable]') || false);
  if (!onTest || inField) return;
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)) {
    if (t && t.closest('button, a') && (e.key === ' ' || e.key === 'Enter')) return;
    e.preventDefault();
    app.controller.forwardKey(e);
  }
});

window.addEventListener('hashchange', route);
// Close open menus (nav "More", mode options) when clicking elsewhere.
document.addEventListener('click', (e) => {
  for (const d of $$('details.more[open], details.run-opts[open]')) if (!d.contains(e.target)) d.open = false;
});

async function boot() {
  const mode = await api.init();
  const pill = $('#net-status');
  pill.dataset.state = mode === 'offline' ? 'offline' : 'online';
  pill.textContent = mode === 'supabase' ? 'online' : mode === 'server' ? 'online' : 'offline';
  pill.title = mode === 'offline' ? 'No backend: everything runs locally; leaderboards are unavailable.' : 'Connected: ranked runs are verified server-side.';
  await route();
}
boot();

// PWA: service worker + install prompt.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#install-btn').hidden = false;
});
$('#install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#install-btn').hidden = true;
});

window.addEventListener('online', () => boot());

export default app;
