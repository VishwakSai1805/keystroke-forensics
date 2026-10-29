// HTTP helpers shared by the Edge Functions: CORS allow-list, JSON responses, auth, client IP.

const allowed = () =>
  (Deno.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const list = allowed();
  const allow = list.length === 0 ? '*' : list.includes(origin) ? origin : list[0];
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function preflight(req) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/** Resolve the caller from the Supabase JWT (anonymous users included). */
export async function requireUser(admin, req) {
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data || !data.user) throw Object.assign(new Error('unauthenticated'), { status: 401 });
  return data.user;
}

export function clientIp(req) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
}

export async function readBody(req, limit = 2_000_000) {
  const text = await req.text();
  if (text.length > limit) throw Object.assign(new Error('payload too large'), { status: 413 });
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}

/** Uniform error mapping: internal errors never leak details. */
export function fail(req, e) {
  return json(req, e && e.status ? e.status : 500, { error: e && e.status ? e.message : 'server error' });
}
