/**
 * Keyboard layouts (QWERTY, Dvorak, Colemak) mapped onto the physical ANSI grid with
 * standard touch-typing finger assignments.
 * @module core/layouts
 */

/** Finger identifiers: L/R + pinky, ring, middle, index; TH = thumb. */
export const FINGERS = Object.freeze(['LP', 'LR', 'LM', 'LI', 'RI', 'RM', 'RR', 'RP', 'TH']);

export const FINGER_NAMES = Object.freeze({
  LP: 'Left pinky',
  LR: 'Left ring',
  LM: 'Left middle',
  LI: 'Left index',
  RI: 'Right index',
  RM: 'Right middle',
  RR: 'Right ring',
  RP: 'Right pinky',
  TH: 'Thumbs',
});

const CODES = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];

const FINGER_GRID = [
  ['LP', 'LP', 'LR', 'LM', 'LI', 'LI', 'RI', 'RI', 'RM', 'RR', 'RP', 'RP', 'RP'],
  ['LP', 'LR', 'LM', 'LI', 'LI', 'RI', 'RI', 'RM', 'RR', 'RP', 'RP', 'RP', 'RP'],
  ['LP', 'LR', 'LM', 'LI', 'LI', 'RI', 'RI', 'RM', 'RR', 'RP', 'RP'],
  ['LP', 'LR', 'LM', 'LI', 'LI', 'RI', 'RI', 'RM', 'RR', 'RP'],
];

const LAYOUT_CHARS = {
  qwerty: [
    ['`1234567890-=', '~!@#$%^&*()_+'],
    ['qwertyuiop[]\\', 'QWERTYUIOP{}|'],
    ["asdfghjkl;'", 'ASDFGHJKL:"'],
    ['zxcvbnm,./', 'ZXCVBNM<>?'],
  ],
  dvorak: [
    ['`1234567890[]', '~!@#$%^&*(){}'],
    ["',.pyfgcrl/=\\", '"<>PYFGCRL?+|'],
    ['aoeuidhtns-', 'AOEUIDHTNS_'],
    [';qjkxbmwvz', ':QJKXBMWVZ'],
  ],
  colemak: [
    ['`1234567890-=', '~!@#$%^&*()_+'],
    ['qwfpgjluy;[]\\', 'QWFPGJLUY:{}|'],
    ["arstdhneio'", 'ARSTDHNEIO"'],
    ['zxcvbkm,./', 'ZXCVBKM<>?'],
  ],
};

export const LAYOUT_NAMES = Object.freeze(Object.keys(LAYOUT_CHARS));

const cache = new Map();

/**
 * Get a layout description.
 * @param {string} name 'qwerty' | 'dvorak' | 'colemak'.
 * @returns {{name:string, rows:{code:string,lower:string,upper:string,finger:string}[][], charMap:Map<string,{code:string,finger:string,shift:boolean,row:number,col:number}>}}
 */
export function getLayout(name = 'qwerty') {
  const key = LAYOUT_CHARS[name] ? name : 'qwerty';
  if (cache.has(key)) return cache.get(key);
  const charMap = new Map();
  const rows = CODES.map((codes, r) =>
    codes.map((code, c) => {
      const lower = LAYOUT_CHARS[key][r][0][c];
      const upper = LAYOUT_CHARS[key][r][1][c];
      const finger = FINGER_GRID[r][c];
      charMap.set(lower, { code, finger, shift: false, row: r, col: c });
      charMap.set(upper, { code, finger, shift: true, row: r, col: c });
      return { code, lower, upper, finger };
    }),
  );
  charMap.set(' ', { code: 'Space', finger: 'TH', shift: false, row: 4, col: 0 });
  charMap.set('\n', { code: 'Enter', finger: 'RP', shift: false, row: 2, col: 11 });
  const layout = Object.freeze({ name: key, rows, charMap });
  cache.set(key, layout);
  return layout;
}

/**
 * Finger responsible for a character on a layout.
 * @param {string} ch Character.
 * @param {string} [layout='qwerty'] Layout name.
 * @returns {string|null} Finger id or null if unmapped.
 */
export function fingerFor(ch, layout = 'qwerty') {
  const hit = getLayout(layout).charMap.get(ch);
  return hit ? hit.finger : null;
}

/**
 * Physical key code for a character on a layout.
 * @param {string} ch Character.
 * @param {string} [layout='qwerty'] Layout name.
 * @returns {string|null}
 */
export function codeFor(ch, layout = 'qwerty') {
  const hit = getLayout(layout).charMap.get(ch);
  return hit ? hit.code : null;
}
