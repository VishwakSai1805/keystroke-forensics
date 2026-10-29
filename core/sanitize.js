/**
 * Input sanitization for user-supplied practice text.
 * Character classes are built from numeric code points so the source stays pure ASCII.
 * @module core/sanitize
 */

export const MAX_CUSTOM_LENGTH = 2000;

const ch = (n) => String.fromCharCode(n);
const cls = (ranges) => new RegExp('[' + ranges.map(([a, b]) => (b === undefined ? ch(a) : ch(a) + '-' + ch(b))).join('') + ']', 'g');

/** Smart punctuation -> ASCII equivalents. */
const SMART = new Map([
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x2013, '-'],
  [0x2014, '-'],
  [0x2026, '...'],
  [0x00a0, ' '],
]);
const SMART_RE = cls([...SMART.keys()].map((k) => [k]));
/** Zero-width, bidi overrides and other format characters that can hide content. */
const INVISIBLE_RE = cls([[0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0xfeff]]);
/** C0/C1 control characters except newline (tab is converted before this runs). */
const CONTROL_RE = cls([
  [0x00, 0x09],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
]);

/**
 * Normalize pasted text into something typeable on a standard keyboard:
 * NFC-normalize, replace smart punctuation, strip control / zero-width / bidi characters,
 * collapse whitespace (keeping single newlines), and cap length.
 * @param {string} input Raw text.
 * @param {number} [maxLength=MAX_CUSTOM_LENGTH] Maximum length.
 * @returns {string}
 */
export function sanitizeText(input, maxLength = MAX_CUSTOM_LENGTH) {
  if (typeof input !== 'string') return '';
  let s = input.normalize('NFC');
  s = s.replace(SMART_RE, (c) => SMART.get(c.charCodeAt(0)));
  s = s.replace(INVISIBLE_RE, '');
  s = s.replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
  s = s.replace(CONTROL_RE, '');
  s = s
    .split('\n')
    .map((l) => l.replace(/ {2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (s.length > maxLength) {
    const cut = s.lastIndexOf(' ', maxLength);
    s = s.slice(0, cut > maxLength * 0.8 ? cut : maxLength);
  }
  return s;
}

/**
 * Escape text for safe interpolation into HTML.
 * @param {string} s Text.
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
