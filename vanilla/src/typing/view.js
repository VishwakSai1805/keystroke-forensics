/**
 * Typing field renderer. One <span> per character; each keystroke repaints only the
 * spans in the engine's lastChange range, then glides the caret with a CSS transform.
 */
const cls = (ch, typedCh, hide) => {
  const base = ch === '\n' ? 'c nl' : 'c';
  if (typedCh === undefined) return base;
  if (hide) return `${base} typed`;
  return `${base} ${typedCh === ch ? 'ok' : 'bad'}`;
};

/**
 * @param {{textEl:HTMLElement, viewport:HTMLElement}} els
 */
export function createTypingView({ textEl, viewport }) {
  let spans = [];
  let text = '';
  let hideTyped = false;
  let idleTimer = null;
  const chars = document.createElement('span');
  const caret = document.createElement('i');
  caret.className = 'caret blink';
  const ghost = document.createElement('i');
  ghost.className = 'ghost-caret';
  ghost.hidden = true;
  textEl.replaceChildren(chars, ghost, caret);

  const lineHeight = () => parseFloat(getComputedStyle(textEl).lineHeight) || 40;

  function appendSpans(from) {
    const frag = document.createDocumentFragment();
    for (let i = from; i < text.length; i++) {
      const s = document.createElement('span');
      s.className = cls(text[i], undefined, false);
      s.textContent = text[i];
      frag.append(s);
      spans.push(s);
    }
    chars.append(frag);
  }

  /** Pixel position of the caret slot before character `pos`. */
  function slot(pos) {
    if (!spans.length) return { x: 0, y: 0 };
    if (pos < spans.length) {
      const s = spans[pos];
      return { x: s.offsetLeft, y: s.offsetTop };
    }
    const last = spans[spans.length - 1];
    return { x: last.offsetLeft + last.offsetWidth, y: last.offsetTop };
  }

  function placeCaret(el, pos) {
    const { x, y } = slot(pos);
    const lh = lineHeight();
    const caretH = el.offsetHeight || lh * 0.7;
    el.style.transform = `translate(${x}px, ${y + (lh - caretH) / 2}px)`;
    return y;
  }

  function scrollTo(y) {
    const lh = lineHeight();
    const shift = y > lh ? y - lh : 0;
    textEl.style.transform = `translateY(${-shift}px)`;
  }

  return {
    /** Full rebuild for a new text. */
    load(snapshot) {
      text = snapshot.text;
      hideTyped = Boolean(snapshot.ui && snapshot.ui.hideTyped);
      spans = [];
      chars.replaceChildren();
      appendSpans(0);
      textEl.style.transform = 'translateY(0)';
      caret.classList.add('blink');
      this.paint(snapshot, 0, snapshot.typed.length + 1);
      scrollTo(placeCaret(caret, snapshot.caret));
    },
    /** Incremental update after a keystroke. */
    update(snapshot) {
      if (snapshot.text.length > spans.length) {
        const from = spans.length;
        text = snapshot.text;
        appendSpans(from);
      }
      const lc = snapshot.lastChange || { from: 0, to: spans.length };
      this.paint(snapshot, Math.max(0, lc.from - 1), lc.to + 1);
      scrollTo(placeCaret(caret, snapshot.caret));
      caret.classList.remove('blink');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => caret.classList.add('blink'), 700);
    },
    paint(snapshot, from, to) {
      const typed = snapshot.typed;
      const end = Math.min(to, spans.length);
      for (let i = from; i < end; i++) {
        const c = cls(text[i], typed[i], hideTyped);
        if (spans[i].className !== c) spans[i].className = c;
      }
    },
    /** Reveal everything (blind mode end). */
    reveal(snapshot) {
      hideTyped = false;
      this.paint(snapshot, 0, snapshot.typed.length);
    },
    /** Ghost caret position (null hides it). */
    ghost(pos) {
      if (pos === null || pos === undefined) {
        ghost.hidden = true;
        return;
      }
      ghost.hidden = false;
      placeCaret(ghost, Math.min(pos, spans.length));
    },
    /** Opponent caret for duels shares the ghost element. */
    get viewport() {
      return viewport;
    },
    relayout(snapshot) {
      scrollTo(placeCaret(caret, snapshot.caret));
    },
  };
}
