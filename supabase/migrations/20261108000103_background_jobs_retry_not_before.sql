-- S6-12: persisted retry backoff for the PDF/report worker. Idempotent; additive only.
--
-- When a render fails transiently the worker puts the job back to 'pending' and waits
-- retryDelayMs(attempts) (30 s, 2 min, 8 min, capped at 15 min) before claiming it again. That wait was
-- held in a process-local map plus an updated_at heuristic, so a worker restart or a second replica could
-- retry too early. The worker now also writes the earliest next claim time to this column and reads it
-- when picking a job to claim. The column is nullable and optional: until this migration is applied the
-- worker falls back to the previous behaviour (it retries the update without the column).

alter table public.background_jobs
  add column if not exists retry_not_before timestamptz;

comment on column public.background_jobs.retry_not_before is
  'Earliest time a requeued (retry) job may be claimed again; written by the worker on requeue (S6-12).';

-- Pending jobs are scanned oldest-first every poll; keep that scan cheap as the table grows.
create index if not exists background_jobs_pending_created_idx
  on public.background_jobs (created_at)
  where status = 'pending';
