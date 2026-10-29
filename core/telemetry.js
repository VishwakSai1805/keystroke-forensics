/**
 * Append-only keystroke telemetry. Raw events are frozen and only ever pushed; paired
 * entries ({key, code, expected, correct, tDown, tUp, isTrusted}) are derived on demand.
 * All timestamps come from performance.now() (monotonic), never Date.now().
 * @module core/telemetry
 */

/**
 * @typedef {Object} TelemetryEntry
 * @property {'key'|'ime'|'paste'|'blur'} kind Event origin.
 * @property {string} key KeyboardEvent.key (or composed character for IME).
 * @property {string} code KeyboardEvent.code ('' when unavailable).
 * @property {'char'|'back'|'reject'|null} op What the engine did with it.
 * @property {number|null} pos Text index affected.
 * @property {string|null} expected Target character at pos.
 * @property {boolean|null} correct Whether the typed character matched.
 * @property {number} tDown performance.now() at keydown.
 * @property {number|null} tUp performance.now() at matching keyup.
 * @property {boolean} isTrusted Event.isTrusted of the keydown.
 * @property {boolean} [ctrl] Ctrl/Alt modifier (word delete).
 */

const pairKey = (code, key) => (code && code !== 'Unidentified' ? code : `k:${key}`);

/**
 * Create a telemetry recorder.
 * @returns {{
 *   down:(e:Omit<TelemetryEntry,'tUp'>)=>void,
 *   up:(e:{code:string,key:string,t:number,isTrusted?:boolean})=>boolean,
 *   mark:(kind:'paste'|'blur'|'ime', t:number, data?:Object)=>void,
 *   events:()=>ReadonlyArray<Object>,
 *   entries:()=>TelemetryEntry[],
 *   size:()=>number
 * }}
 */
export function createTelemetry() {
  /** @type {Object[]} */
  const events = [];
  const pending = new Map();
  return {
    down(e) {
      const ev = Object.freeze({ type: 'down', ...e });
      events.push(ev);
      const k = pairKey(e.code, e.key);
      if (!pending.has(k)) pending.set(k, []);
      pending.get(k).push(events.length - 1);
    },
    up({ code, key, t, isTrusted = true }) {
      const k = pairKey(code, key);
      const q = pending.get(k);
      if (!q || q.length === 0) return false;
      const downIndex = q.shift();
      events.push(Object.freeze({ type: 'up', downIndex, code, key, t, isTrusted }));
      return true;
    },
    mark(kind, t, data = {}) {
      events.push(Object.freeze({ type: 'mark', kind, t, ...data }));
    },
    events: () => events,
    entries: () => pairEntries(events),
    size: () => events.length,
  };
}

/**
 * Derive paired entries from raw append-only events.
 * @param {ReadonlyArray<Object>} events Raw events.
 * @returns {TelemetryEntry[]}
 */
export function pairEntries(events) {
  const ups = new Map();
  for (const ev of events) if (ev.type === 'up') ups.set(ev.downIndex, ev.t);
  const out = [];
  events.forEach((ev, i) => {
    if (ev.type === 'down') {
      const { type: _t, t, ...rest } = ev;
      out.push({ ...rest, tDown: t, tUp: ups.has(i) ? ups.get(i) : null });
    } else if (ev.type === 'mark') {
      const { type: _t, kind, t, ...rest } = ev;
      out.push({ kind, key: '', code: '', op: null, pos: null, expected: null, correct: null, tDown: t, tUp: null, isTrusted: rest.isTrusted ?? true, ...rest });
    }
  });
  return out;
}

/**
 * Keystroke entries that affected the text (characters, rejections, backspaces), in time order.
 * @param {TelemetryEntry[]} entries Entries.
 * @returns {TelemetryEntry[]}
 */
export function keystrokes(entries) {
  return entries.filter((e) => e.op === 'char' || e.op === 'reject' || e.op === 'back');
}

/**
 * Printable keystrokes only (characters typed or rejected).
 * @param {TelemetryEntry[]} entries Entries.
 * @returns {TelemetryEntry[]}
 */
export function charStrokes(entries) {
  return entries.filter((e) => e.op === 'char' || e.op === 'reject');
}
