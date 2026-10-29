/**
 * Streaks, XP, levels, badges, milestone goals and theme unlocks. Pure functions over a
 * plain stats object so the same logic runs in both front-ends.
 * @module core/gamification
 */
import { round } from './metrics.js';

/**
 * @typedef {Object} PlayerStats
 * @property {number} xp
 * @property {number} runs
 * @property {number} cleanRuns Runs finished at 100% final accuracy.
 * @property {number} totalChars
 * @property {string[]} badges
 * @property {string[]} codeLanguages
 * @property {{current:number, best:number, lastDay:string|null}} streak
 * @property {Object<string, number>} bestByBoard Best net WPM per board key.
 */

/** @returns {PlayerStats} */
export function emptyStats() {
  return { xp: 0, runs: 0, cleanRuns: 0, totalChars: 0, badges: [], codeLanguages: [], streak: { current: 0, best: 0, lastDay: null }, bestByBoard: {} };
}

/**
 * XP earned by a run: characters typed, scaled by accuracy, plus a completion bonus.
 * @param {{typedChars:number, finalAccuracy:number, failed?:boolean}} r Result.
 * @returns {number}
 */
export function xpForRun(r) {
  const base = Math.max(0, r.typedChars) / 5;
  const accFactor = Math.max(0, (r.finalAccuracy - 50) / 50);
  return Math.round(base * accFactor + (r.failed ? 0 : 10));
}

/** Cumulative XP required to reach a level (level 1 = 0 XP). */
export function xpForLevel(level) {
  return Math.round(120 * (level - 1) ** 1.6);
}

/**
 * Level and progress for an XP total.
 * @param {number} xp XP.
 * @returns {{level:number, current:number, next:number, progress:number}}
 */
export function levelFromXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const current = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, current, next, progress: round((xp - current) / (next - current), 3) };
}

/**
 * Update a daily streak.
 * @param {{current:number, best:number, lastDay:string|null}} streak Streak.
 * @param {string} day Local day YYYY-MM-DD.
 */
export function updateStreak(streak, day) {
  if (streak.lastDay === day) return { ...streak };
  const prev = streak.lastDay ? new Date(`${streak.lastDay}T00:00:00Z`).getTime() : null;
  const cur = new Date(`${day}T00:00:00Z`).getTime();
  const consecutive = prev !== null && Math.round((cur - prev) / 86400000) === 1;
  const current = consecutive ? streak.current + 1 : 1;
  return { current, best: Math.max(streak.best, current), lastDay: day };
}

/** Badge catalogue. `test` receives the updated stats and the run context. */
export const BADGES = Object.freeze([
  { id: 'first-run', label: 'First contact', description: 'Finish your first run.', test: (s) => s.runs >= 1 },
  { id: 'clean-10', label: 'Clean hands', description: '10 runs at 100% accuracy.', test: (s) => s.cleanRuns >= 10 },
  { id: 'clean-100', label: '100 clean runs', description: '100 runs at 100% accuracy.', test: (s) => s.cleanRuns >= 100 },
  {
    id: 'zero-error-sprint',
    label: 'Zero-error sprint',
    description: 'A timed 15 s or 10-word run with not a single wrong keystroke.',
    test: (_s, { result }) => (result.boardKey === 'timed:15' || result.boardKey === 'words:10') && result.totalKeystrokes > 0 && result.correctKeystrokes === result.totalKeystrokes,
  },
  { id: 'night-owl', label: 'Night owl', description: 'Finish a run between midnight and 5 am.', test: (_s, { hour }) => hour >= 0 && hour < 5 },
  { id: 'wpm-60', label: 'Cruising', description: 'Reach 60 net WPM.', test: (_s, { result }) => result.netWpm >= 60 },
  { id: 'wpm-100', label: 'Century', description: 'Reach 100 net WPM.', test: (_s, { result }) => result.netWpm >= 100 },
  { id: 'marathon', label: 'Marathon', description: 'Complete a 120 s timed run.', test: (_s, { result }) => result.boardKey.startsWith('timed:120') && !result.failed },
  { id: 'streak-7', label: 'Seven days', description: 'Practise seven days in a row.', test: (s) => s.streak.current >= 7 },
  { id: 'polyglot', label: 'Polyglot', description: 'Finish code runs in all four languages.', test: (s) => s.codeLanguages.length >= 4 },
  { id: 'operator', label: 'Operator', description: '40+ WPM in command mode.', test: (_s, { result }) => result.modeId === 'command' && result.netWpm >= 40 },
  { id: 'in-the-zone', label: 'In the zone', description: 'Spend half a run in flow state.', test: (_s, { flowPct }) => flowPct >= 50 },
  { id: 'phish-hunter', label: 'Phish hunter', description: 'Perfect detection in phishing-spot mode.', test: (_s, { detectionAccuracy }) => detectionAccuracy === 100 },
]);

/**
 * Apply a finished run to the stats and award new badges.
 * @param {PlayerStats} stats Stats before.
 * @param {Object} result Run result (engine STEP 6).
 * @param {{day:string, hour:number, flowPct?:number, detectionAccuracy?:number}} ctx Context.
 * @returns {{stats:PlayerStats, xpGained:number, newBadges:typeof BADGES[number][], levelUp:boolean}}
 */
export function applyRun(stats, result, ctx) {
  const xpGained = xpForRun(result);
  const before = levelFromXp(stats.xp).level;
  const s = {
    ...stats,
    xp: stats.xp + xpGained,
    runs: stats.runs + 1,
    cleanRuns: stats.cleanRuns + (result.finalAccuracy === 100 && result.typedChars > 0 ? 1 : 0),
    totalChars: stats.totalChars + result.typedChars,
    streak: updateStreak(stats.streak, ctx.day),
    codeLanguages: result.modeId === 'code' && !stats.codeLanguages.includes(result.options.language) ? [...stats.codeLanguages, result.options.language] : stats.codeLanguages,
    bestByBoard: { ...stats.bestByBoard, [result.boardKey]: Math.max(stats.bestByBoard[result.boardKey] || 0, result.netWpm) },
  };
  const full = { result, hour: ctx.hour, flowPct: ctx.flowPct ?? 0, detectionAccuracy: ctx.detectionAccuracy ?? -1 };
  const newBadges = BADGES.filter((b) => !s.badges.includes(b.id) && b.test(s, full));
  s.badges = [...s.badges, ...newBadges.map((b) => b.id)];
  return { stats: s, xpGained, newBadges, levelUp: levelFromXp(s.xp).level > before };
}

/**
 * Progress toward a milestone goal such as "80 WPM at 97% accuracy".
 * @param {{wpm:number, accuracy:number}} goal Goal.
 * @param {{netWpm:number, finalAccuracy:number}[]} runs Runs to consider.
 * @returns {{wpmPct:number, accPct:number, met:boolean, best:{netWpm:number, finalAccuracy:number}|null}}
 */
export function goalProgress(goal, runs) {
  const qualifying = runs.filter((r) => r.finalAccuracy >= goal.accuracy);
  const best = qualifying.sort((a, b) => b.netWpm - a.netWpm)[0] || runs.slice().sort((a, b) => b.finalAccuracy - a.finalAccuracy)[0] || null;
  if (!best) return { wpmPct: 0, accPct: 0, met: false, best: null };
  const wpmPct = round(Math.min(100, (best.netWpm / goal.wpm) * 100));
  const accPct = round(Math.min(100, (best.finalAccuracy / goal.accuracy) * 100));
  return { wpmPct, accPct, met: best.netWpm >= goal.wpm && best.finalAccuracy >= goal.accuracy, best };
}

/** Theme catalogue with unlock levels. Paper light is always available for accessibility. */
export const THEMES = Object.freeze([
  { id: 'amber', label: 'Amber recorder', unlockLevel: 1 },
  { id: 'paper', label: 'Paper light', unlockLevel: 1 },
  { id: 'terminal', label: 'Terminal green', unlockLevel: 3 },
]);

/**
 * Themes unlocked at a level.
 * @param {number} level Level.
 * @returns {string[]}
 */
export function unlockedThemes(level) {
  return THEMES.filter((t) => level >= t.unlockLevel).map((t) => t.id);
}
