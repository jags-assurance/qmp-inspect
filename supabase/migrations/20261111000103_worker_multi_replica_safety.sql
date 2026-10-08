-- F-04: make running 2+ worker replicas actually safe. Idempotent; additive only.
--
-- Review of the existing claim in worker/src/index.ts (claimNextPendingJob): it SELECTs a window of
-- pending jobs, picks one in application code, then does
--   UPDATE background_jobs SET status='processing', attempts = <stale value> + 1
--    WHERE id = ? AND status = 'pending'.
-- The WHERE status='pending' compare-and-swap does prevent two replicas from BOTH winning one row, but
-- it has three real problems with more than one replica:
--   1. Every replica picks the SAME oldest job from its identical SELECT, so on every cycle one wins
--      and the rest lose the race and idle for a whole poll interval (3s) - extra replicas add
--      almost no throughput and burn queries.
--   2. `attempts` is written from the value read earlier (candidate.attempts + 1), not incremented in
--      SQL. If another replica claimed, failed and requeued that job in between, the second CAS still
--      matches status='pending' and RESETS attempts, so a job can exceed MAX_JOB_ATTEMPTS.
--   3. retry backoff was enforced partly by an in-memory per-process map, so a second replica could
--      pick a job still in backoff.
--
-- Fix: claim_next_background_job() does selection AND claim in one statement with
-- FOR UPDATE SKIP LOCKED - concurrent callers each get a different row (or none), attempts is
-- incremented in SQL, and the backoff (retry_not_before, falling back to updated_at + delay exactly
-- like worker/src/jobs/retryPolicy.ts isJobClaimable) is applied in the database. The worker uses
-- this RPC and falls back to the old compare-and-swap path (now also conditioned on attempts) when
-- the function does not exist yet, so deploy order does not matter.
--
-- Also adds a small lease table so periodic sweeps that must run ONCE per interval (the automation
-- sweep sends notifications) do not run on every replica at once.

-- started_at / retry_not_before may not exist on a database that has not had the earlier migrations.
alter table public.background_jobs add column if not exists started_at timestamptz;
alter table public.background_jobs add column if not exists retry_not_before timestamptz;

create or replace function public.claim_next_background_job()
returns setof public.background_jobs
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.background_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         started_at = now()
   where j.id = (
     select c.id
       from public.background_jobs c
      where c.status = 'pending'
        and (
          c.attempts <= 0
          or (c.retry_not_before is not null and c.retry_not_before <= now())
          or (
            c.retry_not_before is null
            and c.updated_at + least(interval '30 seconds' * power(4, greatest(c.attempts - 1, 0)), interval '15 minutes') <= now()
          )
        )
      -- never-attempted jobs first, then retries; oldest first within each
      order by (c.attempts > 0), c.created_at
      limit 1
      for update skip locked
   )
  returning j.*;
$$;

revoke all on function public.claim_next_background_job() from public, anon, authenticated;
grant execute on function public.claim_next_background_job() to service_role;

comment on function public.claim_next_background_job() is
  'F-04: atomically claims the next eligible pending job (FOR UPDATE SKIP LOCKED), incrementing attempts and honouring retry backoff. Called by the worker with the service role.';

-- Lease for once-per-interval work across replicas.
create table if not exists public.worker_leases (
  name text primary key,
  holder text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.worker_leases enable row level security;
-- No policies: only the service role (which bypasses RLS) and the SECURITY DEFINER function below touch it.
revoke all on table public.worker_leases from anon, authenticated;

create or replace function public.try_acquire_worker_lease(p_name text, p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_won boolean;
begin
  if p_name is null or p_holder is null or p_ttl_seconds is null or p_ttl_seconds <= 0 then
    return false;
  end if;

  -- Insert the lease, or take it over when it has expired or we already hold it (renewal).
  insert into public.worker_leases as l (name, holder, expires_at, updated_at)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict (name) do update
    set holder = excluded.holder,
        expires_at = excluded.expires_at,
        updated_at = now()
    where l.expires_at <= now() or l.holder = excluded.holder
  returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

revoke all on function public.try_acquire_worker_lease(text, text, integer) from public, anon, authenticated;
grant execute on function public.try_acquire_worker_lease(text, text, integer) to service_role;

comment on function public.try_acquire_worker_lease(text, text, integer) is
  'F-04: returns true when the caller now holds the named lease (free, expired, or already its own). Used to run periodic sweeps on one replica at a time.';
