/** Lesson mode: structured drills from core/lessons.js. Unranked. @module core/modes/lesson */
import { generateLessonText, getLesson } from '../lessons.js';
import { completeAtEnd } from './_shared.js';

/** @type {import('./_shared.js').Mode} */
export default {
  id: 'lesson',
  label: 'Lesson',
  category: 'learning',
  defaults: { lessonId: 'home-row', layout: 'qwerty' },
  generate(seed, o) {
    const lesson = getLesson(o.lessonId);
    return { text: generateLessonText(lesson, seed, o.layout), meta: { lessonId: lesson.id, title: lesson.title } };
  },
  isComplete: completeAtEnd,
  ui: { liveStats: true, timer: 'up' },
  scoreRules: { ranked: false, minChars: 0, minAccuracy: 0, boardKey: (o) => `lesson:${o.lessonId}` },
};
