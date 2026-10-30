-- KEYSTROKE FORENSICS - schema for the self-hosted (Render) backend.
-- The database is reachable only from the API server (Render private network); the server
-- scopes every query to the authenticated session user, so ownership rules live in one
-- place: server/pgStore.js. (The Supabase variant enforces the same rules with RLS.)
-- Idempotent: safe to run on every boot.

create table if not exists users (
  id text primary key,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id text primary key references users (id) on delete cascade,
  handle text unique check (handle ~ '^[A-Za-z0-9_.-]{3,24}$')
);

create table if not exists run_tokens (
  run_id uuid primary key,
  user_id text not null references users (id) on delete cascade,
  mode_id text not null,
  options jsonb not null,
  policy text not null check (policy in ('free', 'strict')),
  seed bigint not null,
  text_hash text not null,
  nonce text not null,
  signature text not null,
  issued_at bigint not null,
  expires_at bigint not null,
  consumed_at bigint
);
create index if not exists run_tokens_user_idx on run_tokens (user_id, issued_at desc);

create table if not exists runs (
  id uuid primary key,
  user_id text not null references users (id) on delete cascade,
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
  status text not null check (status in ('verified', 'quarantined', 'unqualified')),
  flags text[] not null default '{}',
  created_at bigint not null
);
create index if not exists runs_board_idx on runs (board_key, status, created_at desc);
create index if not exists runs_user_idx on runs (user_id, board_key, created_at desc);

create table if not exists run_logs (
  run_id uuid primary key references runs (id) on delete cascade,
  entries jsonb not null
);

create table if not exists rate_events (
  bucket text not null,
  at bigint not null
);
create index if not exists rate_events_idx on rate_events (bucket, at desc);

create table if not exists cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique check (invite_code ~ '^[A-Z2-9]{6}$'),
  owner_id text not null references users (id) on delete cascade
);

create table if not exists cohort_members (
  cohort_id uuid not null references cohorts (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  primary key (cohort_id, user_id)
);
