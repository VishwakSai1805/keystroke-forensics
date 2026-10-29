// Production build for the vanilla front-end (no bundler, no runtime dependencies).
// Output layout (deployed as the site root):
//   dist/            vanilla app (index.html, src/, styles/, assets/, sw.js, manifest)
//   dist/core/       shared framework-agnostic core
//   dist/client/     shared browser layer
//   dist/react/      React build (written by `npm run build:react`)
// config.js is generated from PUBLIC env vars only: SUPABASE_URL, SUPABASE_ANON_KEY.
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const out = 'dist';
for (const entry of ['index.html', 'embed.html', 'manifest.webmanifest', 'sw.js', 'config.js', 'src', 'styles', 'assets', 'core', 'client']) {
  rmSync(join(out, entry), { recursive: true, force: true });
}
mkdirSync(out, { recursive: true });
for (const entry of ['index.html', 'embed.html', 'manifest.webmanifest', 'src', 'styles', 'assets']) cpSync(join('vanilla', entry), join(out, entry), { recursive: true });
cpSync('core', join(out, 'core'), { recursive: true });
cpSync('client', join(out, 'client'), { recursive: true });

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
if (/service_role/.test(anon)) throw new Error('Refusing to build: SUPABASE_ANON_KEY looks like a service-role key.');
writeFileSync(join(out, 'config.js'), `window.KF_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anon, localApi: false })};\n`);

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const precache = [
  './',
  ...['index.html', 'config.js', 'manifest.webmanifest', 'src', 'styles', 'assets', 'core', 'client']
    .flatMap((e) => (statSync(join(out, e)).isDirectory() ? walk(join(out, e)) : [join(out, e)]))
    .map((p) => `./${relative(out, p).replace(/\\/g, '/')}`),
];
let buildId = String(Date.now());
try {
  buildId =
    execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || buildId;
} catch {
  /* not a git checkout */
}
const sw = readFileSync('vanilla/sw.js', 'utf8')
  .replace("const BUILD_ID = 'dev';", `const BUILD_ID = '${buildId}-${Date.now().toString(36)}';`)
  .replace(/const PRECACHE = \[[^\]]*\];/, `const PRECACHE = ${JSON.stringify(precache)};`);
writeFileSync(join(out, 'sw.js'), sw);
console.log(`vanilla build -> ${out}/ (${precache.length} files precached, backend: ${url ? 'supabase' : 'none (offline mode)'})`);
