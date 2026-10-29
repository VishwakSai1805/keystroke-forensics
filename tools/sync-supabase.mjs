// Copies the shared /core and /server modules into supabase/functions/_shared so the
// Edge Functions verify runs with byte-identical code to the client. Run before deploying.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const dst = 'supabase/functions/_shared';
for (const dir of ['core', 'server']) rmSync(`${dst}/${dir}`, { recursive: true, force: true });
mkdirSync(`${dst}/server`, { recursive: true });
cpSync('core', `${dst}/core`, { recursive: true });
for (const f of ['runService.js', 'coachService.js']) cpSync(`server/${f}`, `${dst}/server/${f}`);
console.log('synced core + server into', dst);
