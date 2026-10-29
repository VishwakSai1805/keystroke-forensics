// Copies self-hosted fonts from devDependencies into vanilla/assets/fonts (no third-party font CDN at runtime).
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'vanilla/assets/fonts';
mkdirSync(out, { recursive: true });
const files = [
  ['@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2', 'fraunces-var.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'plex-mono-500.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 'plex-mono-600.woff2'],
  ['@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2', 'opendyslexic-400.woff2'],
];
for (const [src, dst] of files) {
  copyFileSync(join('node_modules', src), join(out, dst));
  console.log('font', dst);
}
