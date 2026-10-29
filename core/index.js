/**
 * Public surface of the framework-agnostic core. No DOM access anywhere under /core.
 * @module core
 */
export * from './prng.js';
export * from './engine.js';
export * from './metrics.js';
export * from './telemetry.js';
export * from './textSource.js';
export * from './replay.js';
export * from './analysis.js';
export * from './layouts.js';
export * from './lessons.js';
export * from './sanitize.js';
export * from './gamification.js';
export * from './coach.js';
export * as dynamics from './dynamics.js';
export * as verify from './verify.js';
export { MODES, getMode, listModes, resolveOptions, boardKey, scorePhishing, phishingScore, createPhishingSession } from './modes/index.js';
export { CODE_LANGUAGES } from './corpus/code.js';
export { COMMANDS } from './corpus/security.js';
export { DURATIONS } from './modes/timed.js';
export { COUNTS } from './modes/words.js';
