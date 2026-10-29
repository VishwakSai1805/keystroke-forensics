/**
 * Keyboard capture on a visually hidden textarea (keeps mobile keyboards and screen
 * readers working). Translates DOM events into engine inputs:
 *   - keydown/keyup with performance-timeline timestamps (event.timeStamp is a
 *     DOMHighResTimeStamp on the same clock as performance.now(); never Date.now())
 *   - IME composition -> 'ime' entries (allowed locally, unranked on the server)
 *   - Android/iOS 'Unidentified' keys -> resolved through beforeinput
 *   - paste/drop -> never reach the engine; recorded as 'paste' marks
 */

const stamp = (e) => {
  const now = performance.now();
  const t = e && e.timeStamp;
  return typeof t === 'number' && t > 0 && Math.abs(now - t) < 1000 ? t : now;
};

/**
 * @param {HTMLTextAreaElement} el Hidden textarea.
 * @param {{down:(ev:Object)=>void, up:(ev:Object)=>void, mark:(kind:string, t:number, data?:Object)=>void, restart:()=>void, next:()=>void, intercept?:(ev:Object)=>boolean}} h Handlers.
 * @returns {{detach:()=>void, keydown:(e:KeyboardEvent)=>void}} Detach plus the keydown handler (for forwarding).
 */
export function attachInput(el, h) {
  let pendingMobile = null;
  let lastMobileChar = null;
  let composing = false;

  const clear = () => {
    if (el.value) el.value = '';
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      h.restart();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      h.next();
      return;
    }
    if (e.key === 'Tab') return;
    if (composing || e.isComposing) return;
    if (e.key === 'Unidentified' || e.keyCode === 229) {
      pendingMobile = { t: stamp(e), isTrusted: e.isTrusted };
      return;
    }
    const altGr = e.getModifierState && e.getModifierState('AltGraph');
    if ((e.ctrlKey || e.metaKey) && e.key !== 'Backspace' && !altGr) return;
    if (e.key !== 'Backspace' && e.key !== 'Enter' && e.key.length !== 1) return;
    e.preventDefault();
    const ev = { key: e.key, code: e.code || '', t: stamp(e), isTrusted: e.isTrusted, repeat: e.repeat, ctrl: e.key === 'Backspace' && (e.ctrlKey || e.altKey || e.metaKey) };
    if (h.intercept && h.intercept(ev)) return;
    h.down(ev);
  };

  const onKeyUp = (e) => {
    if (e.key === 'Unidentified' || e.keyCode === 229) {
      if (lastMobileChar) h.up({ key: lastMobileChar, code: 'Unidentified', t: stamp(e), isTrusted: e.isTrusted });
      lastMobileChar = null;
      return;
    }
    h.up({ key: e.key, code: e.code || '', t: stamp(e), isTrusted: e.isTrusted });
  };

  const onBeforeInput = (e) => {
    if (composing) return;
    if (!pendingMobile) {
      // Text arriving without a key event (scripted insertText, autofill, drag-in) is
      // treated exactly like a paste: blocked and logged (real pastes were logged already).
      e.preventDefault();
      if (e.inputType && e.inputType.startsWith('insert') && e.inputType !== 'insertFromPaste' && e.inputType !== 'insertFromDrop') h.mark('paste', stamp(e), { isTrusted: e.isTrusted });
      return;
    }
    const { t, isTrusted } = pendingMobile;
    pendingMobile = null;
    e.preventDefault();
    if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteWordBackward') {
      lastMobileChar = 'Backspace';
      h.down({ key: 'Backspace', code: 'Unidentified', t, isTrusted, ctrl: e.inputType === 'deleteWordBackward' });
    } else if ((e.inputType === 'insertText' || e.inputType === 'insertLineBreak') && (e.data || e.inputType === 'insertLineBreak')) {
      const ch = e.inputType === 'insertLineBreak' ? 'Enter' : e.data;
      if (ch.length === 1 || ch === 'Enter') {
        lastMobileChar = ch;
        const ev = { key: ch, code: 'Unidentified', t, isTrusted };
        if (!(h.intercept && h.intercept(ev))) h.down(ev);
      } else {
        // Autocomplete or swipe inserted several characters at once: treat like a paste.
        h.mark('paste', t, { isTrusted });
      }
    }
  };

  const onCompStart = () => {
    composing = true;
  };
  const onCompEnd = (e) => {
    composing = false;
    const t = stamp(e);
    for (const ch of e.data || '') h.down({ key: ch, code: '', t, isTrusted: e.isTrusted, kind: 'ime' });
    clear();
  };
  // Paste is not cancelled (users may paste anywhere; Lighthouse flags paste-blocking), but
  // pasted text never reaches the engine: the matching beforeinput is cancelled below and
  // the hidden field is cleared. The attempt is logged so the server can reject the run.
  const onPaste = (e) => {
    h.mark('paste', stamp(e), { isTrusted: e.isTrusted });
  };
  const onDrop = (e) => {
    e.preventDefault();
    h.mark('paste', stamp(e), { isTrusted: e.isTrusted });
  };
  const onInput = () => clear();

  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('keyup', onKeyUp);
  el.addEventListener('beforeinput', onBeforeInput);
  el.addEventListener('compositionstart', onCompStart);
  el.addEventListener('compositionend', onCompEnd);
  el.addEventListener('paste', onPaste);
  el.addEventListener('drop', onDrop);
  el.addEventListener('input', onInput);
  const detach = () => {
    el.removeEventListener('keydown', onKeyDown);
    el.removeEventListener('keyup', onKeyUp);
    el.removeEventListener('beforeinput', onBeforeInput);
    el.removeEventListener('compositionstart', onCompStart);
    el.removeEventListener('compositionend', onCompEnd);
    el.removeEventListener('paste', onPaste);
    el.removeEventListener('drop', onDrop);
    el.removeEventListener('input', onInput);
  };
  return { detach, keydown: onKeyDown };
}
