/**
 * Synthesized key sounds via Web Audio (no audio files): mechanical, typewriter, silent.
 * Plus optional haptics through the Vibration API.
 * @module client/sound
 */

let ctx = null;
let noise = null;

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function click({ freq, q, gain, dur, tone }) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * (0.92 + Math.random() * 0.16);
  bp.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
  src.stop(t + dur);
  if (tone) {
    const o = a.createOscillator();
    const og = a.createGain();
    o.frequency.value = tone;
    og.gain.setValueAtTime(gain * 0.25, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(og).connect(a.destination);
    o.start(t);
    o.stop(t + 0.36);
  }
}

const PACKS = {
  silent: null,
  mechanical: { key: { freq: 2600, q: 1.4, gain: 0.35, dur: 0.035 }, space: { freq: 1400, q: 1.1, gain: 0.4, dur: 0.05 }, error: { freq: 700, q: 2, gain: 0.35, dur: 0.06 } },
  typewriter: {
    key: { freq: 3800, q: 3, gain: 0.45, dur: 0.025 },
    space: { freq: 1800, q: 2, gain: 0.45, dur: 0.04 },
    error: { freq: 900, q: 3, gain: 0.4, dur: 0.05 },
    bell: { freq: 4200, q: 8, gain: 0.25, dur: 0.05, tone: 2093 },
  },
};

export const SOUND_PACKS = Object.keys(PACKS);

/**
 * Play feedback for a keystroke.
 * @param {string} pack Pack id.
 * @param {'key'|'space'|'error'|'bell'} kind Sound kind.
 * @param {boolean} [haptics=false] Vibrate on errors.
 */
export function feedback(pack, kind, haptics = false) {
  if (haptics && kind === 'error' && navigator.vibrate) navigator.vibrate(12);
  const p = PACKS[pack];
  if (!p) return;
  const spec = p[kind] || (kind === 'bell' ? null : p.key);
  if (spec) click(spec);
}
