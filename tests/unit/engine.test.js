import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createEngine,
  createState,
  STATES,
  TRANSITIONS,
  canTransition,
  transition,
  displayRandomSentence,
  startTimerOnFirstKeystroke,
  captureInput,
  compareWithOriginal,
  calculateTime,
  computeWpmAndAccuracy,
  displayResults,
} from '../../core/engine.js';
import { replayRun } from '../../core/replay.js';
import { listModes } from '../../core/modes/index.js';
import { typeKeys, keysOf, session } from '../helpers/typist.js';

describe('finite state machine', () => {
  it('declares only legal transitions', () => {
    expect(canTransition('IDLE', 'RUNNING')).toBe(false);
    expect(canTransition('IDLE', 'COMPLETE')).toBe(false);
    expect(canTransition('ARMED', 'COMPLETE')).toBe(false);
    expect(canTransition('RUNNING', 'COMPLETE')).toBe(true);
    expect(Object.keys(TRANSITIONS).sort()).toEqual(Object.values(STATES).sort());
  });
  it('throws on illegal transitions', () => {
    const s = createState();
    expect(() => transition(s, STATES.RUNNING)).toThrow(/Illegal/);
  });
  it('walks IDLE -> ARMED -> RUNNING -> COMPLETE', () => {
    const e = createEngine({ modeId: 'sentence' });
    expect(e.getSnapshot().status).toBe('IDLE');
    e.load({ seed: 1, text: 'ab' });
    expect(e.getSnapshot().status).toBe('ARMED');
    e.keyDown({ key: 'a', code: 'KeyA', t: 100 });
    expect(e.getSnapshot().status).toBe('RUNNING');
    e.keyDown({ key: 'b', code: 'KeyB', t: 300 });
    expect(e.getSnapshot().status).toBe('COMPLETE');
    expect(e.getSnapshot().result.elapsedMs).toBe(200);
  });
});

describe('the seven original steps are individually callable', () => {
  it('runs steps 1-7 by hand', () => {
    const s = createState({ modeId: 'sentence' });
    const text = displayRandomSentence(s, { seed: 3 }); // STEP 1
    expect(text.length).toBeGreaterThan(10);
    expect(startTimerOnFirstKeystroke(s, 10)).toBe(true); // STEP 2
    const r = captureInput(s, { type: 'char', ch: text[0] }); // STEP 3
    expect(r.correct).toBe(true);
    expect(compareWithOriginal(s, 0, text[0])).toBe(true); // STEP 4
    expect(calculateTime(s, 1010)).toBe(1000); // STEP 5
    transition(s, STATES.COMPLETE);
    const result = computeWpmAndAccuracy(s); // STEP 6
    expect(result.typedChars).toBe(1);
    let seen = null;
    displayResults(s, (ev) => (seen = ev)); // STEP 7
    expect(seen.type).toBe('complete');
  });
});

describe('input handling', () => {
  it('starts the timer on the first keystroke, not on load', () => {
    const e = createEngine();
    e.load({ text: 'hi there' });
    expect(e.getSnapshot().startT).toBe(null);
    e.keyDown({ key: 'h', code: 'KeyH', t: 5000 });
    expect(e.getSnapshot().startT).toBe(5000);
  });
  it('ignores backspace before the start and past the beginning', () => {
    const e = createEngine();
    e.load({ text: 'abc' });
    expect(e.keyDown({ key: 'Backspace', t: 1 })).toBe(false);
    e.keyDown({ key: 'x', t: 2 });
    e.keyDown({ key: 'Backspace', t: 3 });
    e.keyDown({ key: 'Backspace', t: 4 });
    expect(e.getSnapshot().caret).toBe(0);
    expect(e.getSnapshot().status).toBe('RUNNING');
  });
  it('ignores auto-repeated characters but tracks corrections', () => {
    const e = createEngine();
    e.load({ text: 'aaa' });
    e.keyDown({ key: 'a', t: 1 });
    expect(e.keyDown({ key: 'a', t: 2, repeat: true })).toBe(false);
    expect(e.getSnapshot().caret).toBe(1);
  });
  it('ignores modifier and navigation keys', () => {
    const e = createEngine();
    e.load({ text: 'abc' });
    for (const key of ['Shift', 'Control', 'ArrowLeft', 'Tab', 'Unidentified', 'Dead']) expect(e.keyDown({ key, t: 1 })).toBe(false);
  });
  it('counts later-corrected errors in raw accuracy but not final accuracy', () => {
    const { engine } = session({ text: 'abcd', keys: () => ['a', 'x', 'Backspace', 'b', 'c', 'd'] });
    const r = engine.getSnapshot().result;
    expect(r.finalAccuracy).toBe(100);
    expect(r.rawAccuracy).toBe(80);
    expect(r.backspaces).toBe(1);
  });
  it('strict policy blocks advancing until the error is fixed', () => {
    const e = createEngine({ policy: 'strict' });
    e.load({ text: 'abc' });
    e.keyDown({ key: 'x', t: 1 });
    e.keyDown({ key: 'b', t: 2 });
    expect(e.getSnapshot().caret).toBe(1);
    e.keyDown({ key: 'Backspace', t: 3 });
    e.keyDown({ key: 'a', t: 4 });
    expect(e.getSnapshot().caret).toBe(1);
    expect(e.entries().filter((x) => x.op === 'reject')).toHaveLength(1);
  });
  it('ctrl+backspace deletes the previous word', () => {
    const e = createEngine();
    e.load({ text: 'one two three' });
    typeKeys(e, keysOf('one tw'));
    e.keyDown({ key: 'Backspace', t: 99999, ctrl: true });
    expect(e.getSnapshot().typed.join('')).toBe('one ');
  });
  it('sudden death fails on the first mistake', () => {
    const { engine } = session({ modeId: 'sudden', keys: (t) => [t[0], t[1] === 'z' ? 'q' : 'z'] });
    expect(engine.getSnapshot().status).toBe('FAILED');
    expect(engine.getSnapshot().result.failed).toBe(true);
  });
  it('timed mode completes at exactly startT + duration and streams text', () => {
    const e = createEngine({ modeId: 'timed', options: { duration: 15 } });
    e.load({ seed: 9 });
    const initial = e.getSnapshot().text.length;
    const text = e.getSnapshot().text;
    typeKeys(e, keysOf(text.slice(0, initial - 30)), { mean: 40, jitter: 0.1 });
    expect(e.getSnapshot().text.length).toBeGreaterThan(initial);
    e.tick(1000 + 15000);
    const snap = e.getSnapshot();
    expect(snap.status).toBe('COMPLETE');
    expect(snap.result.elapsedMs).toBe(15000);
  });
  it('code mode auto-indents after a correct newline', () => {
    const e = createEngine({ modeId: 'code', options: { language: 'python' } });
    e.load({ seed: 1, text: 'if x:\n    y' });
    typeKeys(e, keysOf('if x:\n'));
    expect(e.getSnapshot().caret).toBe(10);
    typeKeys(e, ['y'], { start: 50000 });
    const r = e.getSnapshot().result;
    expect(r.typedChars).toBe(7);
    expect(r.finalAccuracy).toBe(100);
  });
  it('records an append-only telemetry log with dwell pairs', () => {
    const { engine } = session({ text: 'abc' });
    const entries = engine.entries();
    expect(entries).toHaveLength(3);
    for (const x of entries) {
      expect(x.tUp).toBeGreaterThan(x.tDown);
      expect(Object.isFrozen(engine.events()[0])).toBe(true);
    }
  });
});

describe('replay determinism', () => {
  it('same log -> same metrics for every mode', () => {
    for (const m of listModes()) {
      if (m.id === 'custom' || m.id === 'phishing') continue;
      const { engine } = session({ modeId: m.id, seed: 1234, keys: (t) => keysOf(t.slice(0, 120)), typist: { seed: 5 } });
      engine.tick(10_000_000);
      const live = engine.getSnapshot();
      if (!live.result) continue;
      const rep = replayRun({ modeId: m.id, options: live.options, seed: live.seed, entries: engine.entries() }).getSnapshot();
      expect(rep.result, m.id).toEqual(live.result);
    }
  });
  it('property: random logs replay to identical results', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b', ' ', 'Backspace', 'c'), { minLength: 1, maxLength: 60 }), fc.nat(1000), (keys, seed) => {
        const e = createEngine({ modeId: 'words', options: { count: 10 } });
        e.load({ seed });
        typeKeys(e, keys, { seed });
        const a = e.getSnapshot();
        const b = replayRun({ modeId: 'words', options: { count: 10 }, seed, entries: e.entries() }).getSnapshot();
        return JSON.stringify(a.typed) === JSON.stringify(b.typed) && JSON.stringify(a.result) === JSON.stringify(b.result) && a.status === b.status;
      }),
      { numRuns: 150 },
    );
  });
  it('property: appending correct input never lowers final accuracy and keeps it at 100 from clean start', () => {
    fc.assert(
      fc.property(fc.nat(500), fc.integer({ min: 1, max: 40 }), (seed, n) => {
        const e = createEngine({ modeId: 'words', options: { count: 25 } });
        e.load({ seed });
        const text = e.getSnapshot().text;
        let last = -1;
        let t = 100;
        for (const ch of text.slice(0, n)) {
          e.keyDown({ key: ch, t });
          t += 120;
          const acc = e.live(t).finalAccuracy;
          if (acc < last || acc !== 100) return false;
          last = acc;
        }
        return true;
      }),
    );
  });
});
