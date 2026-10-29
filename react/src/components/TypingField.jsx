import { memo, useLayoutEffect, useRef, useEffect } from 'react';

/**
 * One memoized component per character with a stable key (its index). A keystroke changes
 * the props of only the characters around the caret, so React re-renders only those.
 */
const Character = memo(function Character({ ch, typed, hide }) {
  let cls = ch === '\n' ? 'c nl' : 'c';
  if (typed !== undefined) cls += hide ? ' typed' : typed === ch ? ' ok' : ' bad';
  return <span className={cls}>{ch}</span>;
});

export function TypingField({ snapshot, ghostPos, inputRef, onFocus }) {
  const textRef = useRef(null);
  const caretRef = useRef(null);
  const ghostRef = useRef(null);
  const hide = Boolean(snapshot.ui && snapshot.ui.hideTyped) && snapshot.status !== 'COMPLETE' && snapshot.status !== 'FAILED';
  const { text, typed, caret } = snapshot;

  const place = (el, pos) => {
    const root = textRef.current;
    if (!root || !el) return 0;
    const spans = root.querySelector('.chars').children;
    const lh = parseFloat(getComputedStyle(root).lineHeight) || 40;
    let x = 0;
    let y = 0;
    if (spans.length) {
      if (pos < spans.length) {
        x = spans[pos].offsetLeft;
        y = spans[pos].offsetTop;
      } else {
        const last = spans[spans.length - 1];
        x = last.offsetLeft + last.offsetWidth;
        y = last.offsetTop;
      }
    }
    el.style.transform = `translate(${x}px, ${y + (lh - (el.offsetHeight || lh * 0.7)) / 2}px)`;
    return { y, lh };
  };

  useLayoutEffect(() => {
    const r = place(caretRef.current, caret);
    if (r && textRef.current) textRef.current.style.transform = `translateY(${-(r.y > r.lh ? r.y - r.lh : 0)}px)`;
  });

  useEffect(() => {
    if (!ghostRef.current) return;
    ghostRef.current.hidden = ghostPos === null || ghostPos === undefined;
    if (!ghostRef.current.hidden) place(ghostRef.current, ghostPos);
  }, [ghostPos]);

  const chars = [];
  for (let i = 0; i < text.length; i++) chars.push(<Character key={i} ch={text[i]} typed={typed[i]} hide={hide} />);

  return (
    <div
      className="typing"
      onMouseDown={(e) => {
        e.preventDefault();
        onFocus();
      }}
    >
      <div className="tf-viewport">
        <div className="tf-text" ref={textRef} id="tf-text">
          <span className="chars">{chars}</span>
          <i className="ghost-caret" ref={ghostRef} hidden />
          <i className={`caret${snapshot.status === 'ARMED' ? ' blink' : ''}`} ref={caretRef} />
        </div>
      </div>
      <label className="sr-only" htmlFor="typing-input">
        Typing input. Type the text shown. Press Escape to restart.
      </label>
      <textarea id="typing-input" ref={inputRef} className="typing-input" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-describedby="tf-text" />
    </div>
  );
}
