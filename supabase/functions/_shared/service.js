// Shared bootstrap: service-role client (server-side only) and the run service.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createRunService } from './server/runService.js';
import { createSupabaseStore } from './supabaseStore.js';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const secret = Deno.env.get('RUN_TOKEN_SECRET');

export const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
export const store = createSupabaseStore(admin, { url, serviceKey });
export const runs = createRunService({ store, secret });
