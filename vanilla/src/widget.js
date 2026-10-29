/**
 * <keystroke-widget> web component: a compact personal-best card for portfolio sites.
 * Reads the visitor's own local history from IndexedDB on this origin (same-origin iframe
 * via embed.html), or renders the `best`, `accuracy` and `board` attributes when given
 * (for embedding a fixed score on another site). Shadow DOM keeps styles isolated.
 */
const CSS = `
:host{display:block;font-family:'IBM Plex Mono',ui-monospace,monospace;color:#ede6da;background:#0e0d0b;border:1px solid rgba(255,236,205,.16);padding:16px 18px;max-width:360px}
.top{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a59a8c}
.lamp{width:8px;height:8px;border-radius:50%;background:#ffb000;box-shadow:0 0 10px #ffb000}
.big{font-family:Fraunces,Georgia,serif;font-size:64px;line-height:1;color:#ffb000;margin:10px 0 4px}
.row{display:flex;gap:18px;font-size:13px;color:#a59a8c}
.row b{color:#ede6da;font-weight:500}
a{color:#ffb000;font-size:12px}
`;
const TEMPLATE = `<div class="top"><i class="lamp"></i>Keystroke Forensics</div><div class="big" part="wpm">--</div><div class="row"><span>accuracy <b part="acc">--</b></span><span>board <b part="board">--</b></span></div><div class="row"><span>runs <b part="runs">0</b></span><a part="link" target="_blank" rel="noopener">race me</a></div>`;

function bestFromDb() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open('keystroke-forensics');
    } catch {
      resolve(null);
      return;
    }
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('runs')) {
        resolve(null);
        return;
      }
      const all = db.transaction('runs', 'readonly').objectStore('runs').getAll();
      all.onsuccess = () => {
        const runs = all.result || [];
        const best = runs.filter((r) => !r.result.failed).sort((a, b) => b.result.score - a.result.score)[0];
        resolve(best ? { netWpm: best.result.netWpm, accuracy: best.result.finalAccuracy, board: best.boardKey, runs: runs.length } : { runs: 0 });
      };
      all.onerror = () => resolve(null);
    };
  });
}

class KeystrokeWidget extends HTMLElement {
  static get observedAttributes() {
    return ['best', 'accuracy', 'board', 'href'];
  }
  connectedCallback() {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: 'open' });
      // Constructable stylesheets are CSP-safe (no inline <style> needed).
      if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [sheet];
        root.innerHTML = TEMPLATE;
      } else root.innerHTML = `<style>${CSS}</style>${TEMPLATE}`;
    }
    this.refresh();
  }
  attributeChangedCallback() {
    if (this.shadowRoot) this.refresh();
  }
  async refresh() {
    const $ = (p) => this.shadowRoot.querySelector(`[part="${p}"]`);
    const fixed = this.getAttribute('best');
    const data = fixed ? { netWpm: Number(fixed), accuracy: Number(this.getAttribute('accuracy') || 0), board: this.getAttribute('board') || '', runs: '' } : await bestFromDb();
    const href = this.getAttribute('href') || new URL('./', import.meta.url.replace(/src\/widget\.js$/, '')).href;
    $('link').href = href;
    if (!data || !data.netWpm) {
      $('wpm').textContent = '--';
      $('runs').textContent = String((data && data.runs) || 0);
      return;
    }
    $('wpm').textContent = `${Math.round(data.netWpm)} wpm`;
    $('acc').textContent = `${Number(data.accuracy).toFixed(1)}%`;
    $('board').textContent = data.board;
    $('runs').textContent = String(data.runs);
  }
}

if (!customElements.get('keystroke-widget')) customElements.define('keystroke-widget', KeystrokeWidget);
