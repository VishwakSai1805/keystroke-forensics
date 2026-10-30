// Production deploy helper. Two supported backends:
//   Render (recommended, see render.yaml): the backend is created from the Blueprint in the
//     Render dashboard. This script then deploys the Vercel front-end pointed at it:
//       RENDER_API_URL=https://<service>.onrender.com node tools/deploy.mjs --skip-supabase
//   Supabase: schema, RLS, secrets and Edge Functions, then Vercel:
//       SUPABASE_PROJECT_REF=<ref> node tools/deploy.mjs
// Prerequisites (one-time, interactive): npx vercel login (and npx supabase login for Supabase).
// Optional env: ANTHROPIC_API_KEY (Claude coach, Supabase path), VERCEL_SCOPE (team slug).
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const SUPABASE = 'npx --yes supabase@2.122.0';
const VERCEL = 'npx --yes vercel@latest';
const ref = process.env.SUPABASE_PROJECT_REF;
const scope = process.env.VERCEL_SCOPE ? ` --scope ${process.env.VERCEL_SCOPE}` : '';
const skipSb = process.argv.includes('--skip-supabase');
const skipVc = process.argv.includes('--skip-vercel');

const run = (cmd, opts = {}) => {
  console.log(`\n$ ${cmd.replace(/(--build-env SUPABASE_ANON_KEY=)\S+/, '$1***')}`);
  return execSync(cmd, { stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
};

const renderUrl = (process.env.RENDER_API_URL || '').replace(/\/$/, '');
if (!ref && !skipSb) {
  console.error('Set SUPABASE_PROJECT_REF (Supabase dashboard -> Project Settings -> General -> Reference ID).');
  process.exit(1);
}

let url = '';
let anon = '';
if (ref) {
  url = `https://${ref}.supabase.co`;
  const keys = JSON.parse(run(`${SUPABASE} projects api-keys --project-ref ${ref} -o json`, { capture: true }));
  const pub = keys.find((k) => k.type === 'publishable') || keys.find((k) => k.name === 'anon');
  anon = pub && (pub.api_key || pub.key);
  if (!anon) throw new Error('Could not read the anon / publishable key.');
}

if (!skipSb) {
  run(`${SUPABASE} link --project-ref ${ref}`);
  run(`${SUPABASE} db push`);
  run(`${SUPABASE} config push`);
  run('node tools/sync-supabase.mjs');
  const secrets = [`RUN_TOKEN_SECRET=${randomBytes(32).toString('hex')}`];
  if (process.env.ALLOWED_ORIGINS) secrets.push(`ALLOWED_ORIGINS=${process.env.ALLOWED_ORIGINS}`);
  if (process.env.ANTHROPIC_API_KEY) secrets.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
  // Secrets go straight to Supabase; nothing is written to disk or to the client bundle.
  execSync(`${SUPABASE} secrets set --project-ref ${ref} ${secrets.map((s) => `"${s}"`).join(' ')}`, { stdio: ['inherit', 'ignore', 'inherit'] });
  console.log('\nsecrets set: RUN_TOKEN_SECRET' + (process.env.ANTHROPIC_API_KEY ? ', ANTHROPIC_API_KEY' : ''));
  run(`${SUPABASE} functions deploy run-token submit-run ai-coach --project-ref ${ref}`);
}

if (!skipVc) {
  const env = url ? ` --build-env SUPABASE_URL=${url} --build-env SUPABASE_ANON_KEY=${anon}` : renderUrl ? ` --build-env KF_API_BASE=${renderUrl}` : '';
  run(`${VERCEL} deploy --prod --yes${scope}${env}`);
}
console.log('\nDeploy complete.');
