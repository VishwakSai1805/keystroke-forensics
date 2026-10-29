/**
 * Structured touch-typing lessons: home row -> top row -> bottom row -> numbers -> symbols.
 * Key sets are derived from the active layout so Dvorak and Colemak learners drill their own rows.
 * @module core/lessons
 */
import { getLayout } from './layouts.js';
import { createRng } from './prng.js';
import { COMMON_WORDS } from './corpus/words.js';

/**
 * @typedef {Object} Lesson
 * @property {string} id
 * @property {string} title
 * @property {string} blurb
 * @property {(layout:ReturnType<typeof getLayout>)=>string[]} keys Allowed characters.
 * @property {{minWpm:number, minAccuracy:number}} pass Pass criteria.
 */

const rowLetters = (layout, r, shifted = false) => layout.rows[r].map((k) => (shifted ? k.upper : k.lower));
const isLetter = (c) => /[a-z]/i.test(c);

/** @type {Lesson[]} */
export const LESSONS = [
  {
    id: 'home-row',
    title: 'Home row',
    blurb: 'Anchor both index fingers on the bumps and keep every finger resting on its home key.',
    keys: (l) => rowLetters(l, 2).filter(isLetter),
    pass: { minWpm: 15, minAccuracy: 95 },
  },
  {
    id: 'top-row',
    title: 'Top row',
    blurb: 'Reach up and return. The hand stays planted; only the finger travels.',
    keys: (l) => [...rowLetters(l, 2), ...rowLetters(l, 1)].filter(isLetter),
    pass: { minWpm: 20, minAccuracy: 95 },
  },
  {
    id: 'bottom-row',
    title: 'Bottom row',
    blurb: 'Curl down from home. Bottom-row reaches are where most accuracy is lost.',
    keys: (l) => [...rowLetters(l, 1), ...rowLetters(l, 2), ...rowLetters(l, 3)].filter(isLetter),
    pass: { minWpm: 20, minAccuracy: 95 },
  },
  {
    id: 'numbers',
    title: 'Numbers',
    blurb: 'Digits sit two rows above home. Keep your eyes on the screen.',
    keys: (l) => [...rowLetters(l, 0).filter((c) => /\d/.test(c)), ...rowLetters(l, 2).filter(isLetter)],
    pass: { minWpm: 15, minAccuracy: 93 },
  },
  {
    id: 'symbols',
    title: 'Symbols',
    blurb: 'Shifted symbols use the opposite-hand pinky on Shift. Slow and deliberate wins.',
    keys: (l) => [...rowLetters(l, 0, true), ...l.rows.flatMap((r) => r.map((k) => k.lower))].filter((c) => !/[a-z0-9]/i.test(c)),
    pass: { minWpm: 12, minAccuracy: 92 },
  },
];

/**
 * Get a lesson by id (defaults to the first).
 * @param {string} id Lesson id.
 * @returns {Lesson}
 */
export function getLesson(id) {
  return LESSONS.find((l) => l.id === id) || LESSONS[0];
}

/**
 * Generate drill text: real words made only of allowed letters, padded with letter groups.
 * @param {Lesson} lesson Lesson.
 * @param {number} seed Seed.
 * @param {string} [layoutName='qwerty'] Layout.
 * @returns {string}
 */
export function generateLessonText(lesson, seed, layoutName = 'qwerty') {
  const rng = createRng(seed);
  const allowed = [...new Set(lesson.keys(getLayout(layoutName)))];
  const set = new Set(allowed);
  const letters = allowed.filter(isLetter);
  const words = COMMON_WORDS.filter((w) => [...w].every((c) => set.has(c)));
  const tokens = [];
  for (let i = 0; i < 20; i++) {
    const useWord = words.length >= 6 && rng.chance(0.6);
    if (useWord) {
      tokens.push(rng.pick(words));
      continue;
    }
    const n = 3 + rng.int(3);
    let t = '';
    for (let j = 0; j < n; j++) {
      const pool = j === 0 || letters.length === 0 ? allowed : rng.chance(0.7) ? letters : allowed;
      t += rng.pick(pool);
    }
    tokens.push(t);
  }
  return tokens.join(' ');
}

/**
 * Whether a result meets a lesson's pass criteria.
 * @param {Lesson} lesson Lesson.
 * @param {{netWpm:number, finalAccuracy:number}} result Run result.
 * @returns {boolean}
 */
export function lessonPassed(lesson, result) {
  return result.netWpm >= lesson.pass.minWpm && result.finalAccuracy >= lesson.pass.minAccuracy;
}
