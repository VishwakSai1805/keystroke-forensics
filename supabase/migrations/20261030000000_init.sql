-- KEYSTROKE FORENSICS - schema, Row Level Security, leaderboard functions.
-- Trust model: clients never write runs. Only the submit-run Edge Function (service role)
-- inserts runs after recomputing every metric from the raw keystroke log.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique check (handle ~ '^[A-Za-z0-9_.-]{3,24}$'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles readable by all" on public.profiles for select using (true);
create policy "users insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------- run tokens (service role only)
create table public.run_tokens (
  run_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode_id text not null,
  options jsonb not null,
  policy text not null check (policy in ('free', 'strict')),
  seed bigint not null,
  text_hash text not null,
  nonce text not null,
  signature text not null,
  issued_at bigint not null,
  expires_at bigint not null,
  consumed_at timestamptz
);
create index run_tokens_user_idx on public.run_tokens (user_id, issued_at desc);
alter table public.run_tokens enable row level security;
-- No policies: anon/authenticated roles can neither read nor write. Service role bypasses RLS.

-- ---------------------------------------------------------------- runs
create table public.runs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  board_key text not null,
  mode_id text not null,
  language text,
  seed bigint not null,
  net_wpm numeric(6, 1) not null check (net_wpm >= 0),
  gross_wpm numeric(6, 1) not null check (gross_wpm >= 0),
  raw_accuracy numeric(5, 1) not null check (raw_accuracy between 0 and 100),
  final_accuracy numeric(5, 1) not null check (final_accuracy between 0 and 100),
  consistency numeric(5, 1) not null check (consistency between 0 and 100),
  score numeric(8, 2) not null check (score >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  chars integer not null check (chars >= 0),
  -- verification fields: written only by the service role
  status text not null check (status in ('verified', 'quarantined', 'unqualified')),
  flags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index runs_board_idx on public.runs (board_key, status, created_at desc);
create index runs_user_idx on public.runs (user_id, board_key, created_at desc);
alter table public.runs enable row level security;
-- Clients cannot select runs directly (that would leak status/flags and break the shadow-ban).
-- Reads go through the security-definer functions below, which expose only safe columns.

create table public.run_logs (
  run_id uuid primary key references public.runs (id) on delete cascade,
  entries jsonb not null
);
alter table public.run_logs enable row level security;

-- ---------------------------------------------------------------- rate limiting (service role)
create table public.rate_events (
  bucket text not null,
  at timestamptz not null default now()
);
create index rate_events_idx on public.rate_events (bucket, at desc);
alter table public.rate_events enable row level security;

-- ---------------------------------------------------------------- cohorts
create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique check (invite_code ~ '^[A-Z2-9]{6}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.cohort_members (
  cohort_id uuid not null references public.cohorts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);
alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;
create policy "members see their cohorts" on public.cohorts for select
  using (exists (select 1 from public.cohort_members m where m.cohort_id = id and m.user_id = auth.uid()));
create policy "members see co-members" on public.cohort_members for select
  using (user_id = auth.uid());
create policy "users leave cohorts" on public.cohort_members for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------- functions
-- Rate-limit helper: atomically records a hit and returns hits in the window.
create or replace function public.rate_hit(p_bucket text, p_window_ms integer)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into rate_events (bucket) values (p_bucket);
  delete from rate_events where bucket = p_bucket and at < now() - make_interval(secs => p_window_ms / 1000.0 * 5);
  select count(*) into n from rate_events where bucket = p_bucket and at > now() - make_interval(secs => p_window_ms / 1000.0);
  return n;
end $$;
revoke all on function public.rate_hit(text, integer) from public, anon, authenticated;

-- Atomic single-use consumption of a run token (replay protection).
create or replace function public.consume_run_token(p_run_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update run_tokens set consumed_at = now() where run_id = p_run_id and consumed_at is null returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.consume_run_token(uuid) from public, anon, authenticated;

-- Leaderboard: best verified score per user on one board for a period, optionally a cohort.
create or replace function public.get_leaderboard(p_board text, p_period text, p_cohort text default null)
returns table (rank bigint, handle text, score numeric, net_wpm numeric, accuracy numeric, consistency numeric, created_at timestamptz, is_me boolean)
language sql stable security definer set search_path = public as $$
  with scoped as (
    select r.* from runs r
    where r.board_key = p_board
      and r.status = 'verified'
      and r.created_at >= case p_period when 'daily' then now() - interval '1 day'
                                         when 'weekly' then now() - interval '7 days'
                                         else '-infinity'::timestamptz end
      and (p_cohort is null or exists (
            select 1 from cohort_members m join cohorts c on c.id = m.cohort_id
            where c.invite_code = p_cohort and m.user_id = r.user_id
              and exists (select 1 from cohort_members me where me.cohort_id = c.id and me.user_id = auth.uid())))
  ), best as (
    select distinct on (user_id) * from scoped order by user_id, score desc, created_at asc
  )
  select row_number() over (order by b.score desc, b.created_at asc),
         coalesce(p.handle, 'typist-' || left(b.user_id::text, 6)),
         b.score, b.net_wpm, b.final_accuracy, b.consistency, b.created_at, b.user_id = auth.uid()
  from best b left join profiles p on p.id = b.user_id
  order by b.score desc, b.created_at asc
  limit 50;
$$;
grant execute on function public.get_leaderboard(text, text, text) to anon, authenticated;

-- Personal board. Quarantined runs are shown to their owner as accepted (shadow-ban).
create or replace function public.get_personal_board()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'bests', coalesce((select json_agg(x) from (
        select distinct on (board_key) board_key as board, score, net_wpm, final_accuracy as accuracy, created_at
        from runs where user_id = auth.uid() and status in ('verified', 'quarantined')
        order by board_key, score desc) x), '[]'::json),
    'trend', coalesce((select json_agg(t order by t.day) from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, max(net_wpm) as net_wpm
        from runs where user_id = auth.uid() and status in ('verified', 'quarantined') and created_at > now() - interval '30 days'
        group by 1) t), '[]'::json));
$$;
grant execute on function public.get_personal_board() to authenticated;

create or replace function public.set_handle(p_handle text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_handle !~ '^[A-Za-z0-9_.-]{3,24}$' then raise exception 'handle must be 3-24 letters, digits, _ . -'; end if;
  insert into profiles (id, handle) values (auth.uid(), p_handle)
    on conflict (id) do update set handle = excluded.handle;
  return json_build_object('handle', p_handle);
end $$;
grant execute on function public.set_handle(text) to authenticated;

create or replace function public.create_cohort(p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  loop
    v_code := '';
    for i in 1..6 loop v_code := v_code || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1); end loop;
    exit when not exists (select 1 from cohorts where invite_code = v_code);
  end loop;
  insert into cohorts (name, invite_code, owner_id) values (trim(p_name), v_code, auth.uid()) returning id into v_id;
  insert into cohort_members (cohort_id, user_id) values (v_id, auth.uid());
  return json_build_object('name', trim(p_name), 'code', v_code);
end $$;
grant execute on function public.create_cohort(text) to authenticated;

create or replace function public.join_cohort(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare c cohorts;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into c from cohorts where invite_code = upper(p_code);
  if not found then raise exception 'unknown invite code'; end if;
  insert into cohort_members (cohort_id, user_id) values (c.id, auth.uid()) on conflict do nothing;
  return json_build_object('name', c.name, 'code', c.invite_code);
end $$;
grant execute on function public.join_cohort(text) to authenticated;

create or replace function public.my_cohorts()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('name', c.name, 'code', c.invite_code)), '[]'::json)
  from cohorts c join cohort_members m on m.cohort_id = c.id where m.user_id = auth.uid();
$$;
grant execute on function public.my_cohorts() to authenticated;

create or replace function public.delete_my_data()
returns json language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  delete from runs where user_id = auth.uid();
  delete from run_tokens where user_id = auth.uid();
  delete from cohort_members where user_id = auth.uid();
  delete from cohorts where owner_id = auth.uid();
  delete from profiles where id = auth.uid();
  return json_build_object('deleted', true);
end $$;
grant execute on function public.delete_my_data() to authenticated;

-- Lock down: default privileges must not let clients write verification fields.
revoke insert, update, delete on public.runs, public.run_logs, public.run_tokens, public.rate_events from anon, authenticated;
revoke select on public.runs, public.run_logs, public.run_tokens, public.rate_events from anon, authenticated;
