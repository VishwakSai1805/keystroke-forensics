/**
 * On-screen keyboard: live heatmap (fill = error rate, ring thickness = latency) and a
 * touch-typing coach that highlights the key and finger for the next character.
 * Framework-neutral: builds DOM into a container and returns an updater.
 * @module client/keyboard
 */
import { getLayout, FINGER_NAMES } from '../core/layouts.js';
import { escapeHtml as esc } from '../core/sanitize.js';

/**
 * Mount a keyboard.
 * @param {HTMLElement} container Container.
 * @param {string} layoutName Layout.
 * @returns {{update:(heat:Object<string,{errorRate:number, meanLatency:number, count:number}>)=>void, target:(ch:string|null)=>void, setLayout:(name:string)=>void}}
 */
export function mountKeyboard(container, layoutName = 'qwerty') {
  let layout = getLayout(layoutName);
  let keys = new Map();
  let lastTarget = null;
  const fingerEl = document.createElement('div');

  function build() {
    const rows = layout.rows
      .map((row) => `<div class="kb-row">${row.map((k) => `<div class="key" data-code="${esc(k.code)}" title="${esc(FINGER_NAMES[k.finger])}">${esc(k.lower)}</div>`).join('')}</div>`)
      .join('');
    container.innerHTML = `<div class="kb" role="img" aria-label="Keyboard heatmap: key colour shows error rate, inner ring shows latency">${rows}<div class="kb-row"><div class="key space" data-code="Space">space</div></div></div><div class="kb-legend"><span>fill = error rate</span><span>ring = latency</span><span>layout: ${esc(layout.name)}</span></div>`;
    fingerEl.className = 'kb-finger';
    fingerEl.setAttribute('aria-live', 'off');
    container.append(fingerEl);
    keys = new Map([...container.querySelectorAll('.key')].map((el) => [el.dataset.code, el]));
  }
  build();

  return {
    update(heat) {
      for (const [code, el] of keys) {
        const h = heat[code];
        if (!h || h.count < 2) {
          el.style.setProperty('--heat', '0');
          el.style.setProperty('--ring', '0px');
          el.removeAttribute('data-hot');
          continue;
        }
        const e = Math.min(1, h.errorRate / 25);
        const ring = Math.max(0, Math.min(5, (h.meanLatency - 120) / 60));
        el.style.setProperty('--heat', e.toFixed(2));
        el.style.setProperty('--ring', `${ring.toFixed(1)}px`);
        if (e > 0.55) el.dataset.hot = '';
        else el.removeAttribute('data-hot');
      }
    },
    target(ch) {
      if (lastTarget) lastTarget.classList.remove('target');
      lastTarget = null;
      if (ch === null || ch === undefined) {
        fingerEl.textContent = '';
        return;
      }
      const hit = layout.charMap.get(ch);
      if (!hit) {
        fingerEl.textContent = '';
        return;
      }
      const el = keys.get(hit.code);
      if (el) {
        el.classList.add('target');
        lastTarget = el;
      }
      const shift = hit.shift ? ` + ${hit.finger.startsWith('L') ? 'right' : 'left'} Shift` : '';
      fingerEl.textContent = `Next: ${ch === ' ' ? 'space' : ch === '\n' ? 'enter' : ch} - ${FINGER_NAMES[hit.finger]}${shift}`;
    },
    setLayout(name) {
      layout = getLayout(name);
      build();
    },
  };
}
