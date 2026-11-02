/** Mode selector and per-mode option chips above the typing field. */
import { listModes, getMode, resolveOptions } from '../../../core/modes/index.js';
import { CODE_LANGUAGES } from '../../../core/corpus/code.js';
import { COMMANDS } from '../../../core/corpus/security.js';
import { LESSONS } from '../../../core/lessons.js';
import { sanitizeText, MAX_CUSTOM_LENGTH } from '../../../core/sanitize.js';
import { html, raw, esc, toast } from '../dom.js';

/** The few modes shown as buttons; everything else lives in the More modes list. */
const PRIMARY = [
  ['sentence', 'Sentence'],
  ['words', 'Words'],
  ['timed', 'Time'],
  ['quote', 'Quote'],
  ['code', 'Code'],
];

const CATEGORY_LABELS = { core: 'Core', skill: 'Skill', competitive: 'Competitive', security: 'Security', learning: 'Learning' };

const OPTION_SETS = {
  timed: [
    { key: 'duration', values: [15, 30, 60, 120], label: (v) => `${v}s` },
    { key: 'punctuation', toggle: true, label: () => 'punctuation' },
    { key: 'numbers', toggle: true, label: () => 'numbers' },
  ],
  words: [{ key: 'count', values: [10, 25, 50, 100], label: (v) => `${v}` }],
  punctuation: [{ key: 'count', values: [25, 50], label: (v) => `${v} words` }],
  quote: [{ key: 'length', values: ['short', 'medium', 'long'], label: (v) => v }],
  code: [{ key: 'language', values: CODE_LANGUAGES, label: (v) => v }],
  scrambled: [{ key: 'variant', values: ['scramble', 'reverse'], label: (v) => v }],
  command: [{ key: 'set', values: ['all', ...Object.keys(COMMANDS)], label: (v) => v }],
  logs: [{ key: 'kind', values: ['siem', 'payload'], label: (v) => (v === 'siem' ? 'SIEM logs' : 'hex / base64') }],
  lesson: [{ key: 'lessonId', values: LESSONS.map((l) => l.id), label: (v) => LESSONS.find((l) => l.id === v).title }],
};

/**
 * @param {HTMLElement} el Container.
 * @param {{store:Object, controller:Object, navigate:(h:string)=>void}} app
 */
export function mountModebar(el, app) {
  const { store } = app;

  function render() {
    const s = store.get();
    const modeId = s.modeId;
    const mode = getMode(modeId);
    const opts = resolveOptions(modeId, (s.modeOptions || {})[modeId] || {});
    const isPrimary = PRIMARY.some(([id]) => id === modeId);
    const groups = Object.entries(CATEGORY_LABELS)
      .map(([cat, label]) => {
        const modes = listModes(cat).filter((m) => m.id !== 'duel');
        return modes.length
          ? `<optgroup label="${esc(label)}">${modes.map((m) => `<option value="${esc(m.id)}"${m.id === modeId && !isPrimary ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</optgroup>`
          : '';
      })
      .join('');
    const primary = PRIMARY.map(([id, label]) => html`<button class="chip mode-chip" type="button" data-mode="${id}" aria-pressed="${id === modeId}">${label}</button>`).join('');
    const chips = (OPTION_SETS[modeId] || [])
      .map((set) => {
        if (set.toggle) return html`<button class="chip" type="button" data-toggle="${set.key}" aria-pressed="${Boolean(opts[set.key])}">${set.label()}</button>`;
        return set.values
          .map((v) => html`<button class="chip" type="button" data-opt="${set.key}" data-val="${String(v)}" aria-pressed="${String(opts[set.key]) === String(v)}">${set.label(v)}</button>`)
          .join('');
      })
      .join('<span class="sep" aria-hidden="true"></span>');
    const custom = modeId === 'custom' ? html`<button class="chip" type="button" data-custom aria-expanded="false">edit text</button>` : '';
    const ghostable = mode.scoreRules.ranked && modeId !== 'daily';
    el.innerHTML = html`<div class="mode-row">
        <div class="chips" role="group" aria-label="Mode">${raw(primary)}</div>
        <label class="sr-only" for="mode-select">All modes</label>
        <select id="mode-select" class="more-modes${isPrimary ? '' : ' active'}" aria-label="All modes">
          <option value="" disabled${isPrimary ? ' selected' : ''}>More modes</option>
          ${raw(groups)}
        </select>
        <details class="run-opts">
          <summary title="Run options">Options</summary>
          <div class="run-opts-menu" role="group" aria-label="Run options">
            <button class="chip" type="button" data-policy aria-pressed="${s.policy === 'strict'}" title="Errors must be fixed before advancing">Strict backspace</button>
            ${raw(ghostable ? html`<button class="chip" type="button" data-ghost aria-pressed="${Boolean(s.ghost)}" title="Race a replay of your personal best">Race my best</button>` : '')}
            ${raw(mode.scoreRules.ranked ? html`<button class="chip" type="button" data-ranked aria-pressed="${Boolean(s.ranked)}" title="Submit to the leaderboard">Leaderboard runs</button>` : '')}
            <button class="chip" type="button" data-telemetry aria-pressed="${Boolean(s.showTelemetry)}">Live stats</button>
            <button class="chip" type="button" data-keyboard aria-pressed="${Boolean(s.showKeyboard)}">Keyboard heatmap</button>
            <button class="chip" type="button" data-duel>Duel a friend</button>
          </div>
        </details>
        <button class="btn ghost" type="button" data-new title="New text (Ctrl+Enter)">New text</button>
      </div>
      ${raw(chips || custom ? html`<div class="chips sub-chips" role="group" aria-label="Mode options">${raw(chips)}${raw(custom)}</div>` : '')}
      <div id="custom-panel" hidden></div>`;
  }

  function setOption(key, value) {
    const s = store.get();
    const all = { ...(s.modeOptions || {}) };
    all[s.modeId] = { ...(all[s.modeId] || {}), [key]: value };
    store.set({ modeOptions: all });
  }

  el.addEventListener('change', (e) => {
    if (e.target.id === 'mode-select' && e.target.value) {
      store.set({ modeId: e.target.value });
      render();
      app.controller.start();
    }
  });

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = store.get();
    if (b.dataset.mode) {
      store.set({ modeId: b.dataset.mode });
    } else if ('telemetry' in b.dataset) {
      store.set({ showTelemetry: !s.showTelemetry });
      render();
      el.querySelector('.run-opts').open = true;
      return;
    } else if ('keyboard' in b.dataset) {
      store.set({ showKeyboard: !s.showKeyboard });
      render();
      el.querySelector('.run-opts').open = true;
      return;
    } else if (b.dataset.opt) {
      const raw0 = b.dataset.val;
      setOption(b.dataset.opt, /^\d+$/.test(raw0) ? Number(raw0) : raw0);
    } else if (b.dataset.toggle) {
      const cur = resolveOptions(s.modeId, (s.modeOptions || {})[s.modeId] || {});
      setOption(b.dataset.toggle, !cur[b.dataset.toggle]);
    } else if ('policy' in b.dataset) {
      store.set({ policy: s.policy === 'strict' ? 'free' : 'strict' });
    } else if ('ghost' in b.dataset) {
      store.set({ ghost: !s.ghost });
    } else if ('ranked' in b.dataset) {
      store.set({ ranked: !s.ranked });
    } else if ('duel' in b.dataset) {
      app.navigate('#/duel');
      return;
    } else if ('custom' in b.dataset) {
      openCustom();
      return;
    } else if (!('new' in b.dataset)) return;
    render();
    app.controller.start();
  });

  function openCustom() {
    const panel = el.querySelector('#custom-panel');
    const s = store.get();
    const current = ((s.modeOptions || {}).custom || {}).text || '';
    panel.hidden = false;
    panel.innerHTML = html`<div class="field">
        <label for="custom-text">Custom text (max ${MAX_CUSTOM_LENGTH} characters; control and invisible characters are stripped)</label
        ><textarea id="custom-text" maxlength="${MAX_CUSTOM_LENGTH * 2}">${current}</textarea>
      </div>
      <div class="btn-row"><button class="btn primary" type="button" id="custom-use">Use this text</button><button class="btn ghost" type="button" id="custom-cancel">Cancel</button></div>`;
    panel.querySelector('#custom-text').focus();
    panel.querySelector('#custom-use').onclick = () => {
      const clean = sanitizeText(panel.querySelector('#custom-text').value);
      if (!clean) {
        toast('Nothing typeable left after sanitizing.');
        return;
      }
      setOption('text', clean);
      panel.hidden = true;
      app.controller.start();
    };
    panel.querySelector('#custom-cancel').onclick = () => {
      panel.hidden = true;
    };
  }

  render();
  return { render };
}
