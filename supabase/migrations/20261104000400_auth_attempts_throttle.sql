-- E-04 / S1-10: app-level throttle counters for sign-in and password-reset requests.
--
-- Supabase Auth has its own rate limits, but the app had none of its own, so credential stuffing
-- against a single account was bounded only by those defaults. The web app records failed sign-ins
-- (and every reset request) here, keyed by a hash of the email and of the client IP, and refuses
-- further attempts once a per-window limit is reached (lib/auth/throttle.ts).
--
-- Service role only: RLS is enabled with no policies, so neither anon nor authenticated can read or
-- write it. Rows are small and pruned opportunistically by the app; a scheduled delete of rows older
-- than 2 days is also safe. Idempotent.

create table if not exists public.auth_attempts (
  id bigserial primary key,
  key text not null,
  kind text not null check (kind in ('signin', 'reset')),
  created_at timestamptz not null default now()
);

create index if not exists auth_attempts_lookup_idx on public.auth_attempts (key, kind, created_at desc);
create index if not exists auth_attempts_created_idx on public.auth_attempts (created_at);

alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;
