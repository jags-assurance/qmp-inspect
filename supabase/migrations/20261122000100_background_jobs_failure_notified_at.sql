-- Admin alert for permanently failed background jobs: exactly-once guard. Idempotent; additive only.
--
-- When a PDF / report job fails its last attempt (status 'failed') the worker notifies the
-- organisation's admins through the normal notifications -> email_outbox path. failure_notified_at is
-- claimed with "UPDATE ... WHERE failure_notified_at IS NULL" before anything is sent, so the immediate
-- path, the worker's catch-up sweep and a second replica can never alert twice for the same job. The
-- column is nullable and optional: until this migration is applied the worker dedupes on the job id
-- carried in the notification link instead (and the catch-up sweep stays off).

alter table public.background_jobs
  add column if not exists failure_notified_at timestamptz;

comment on column public.background_jobs.failure_notified_at is
  'Set by the worker when the admins were told this job failed permanently; the exactly-once guard for that alert.';

-- Jobs that had already failed before this migration must not trigger a burst of alerts on the first
-- catch-up sweep. This only stamps the new column; no row is deleted or otherwise changed.
update public.background_jobs
   set failure_notified_at = coalesce(completed_at, updated_at, now())
 where status = 'failed'
   and failure_notified_at is null;

-- The catch-up sweep looks for recent failed jobs nobody was told about.
create index if not exists background_jobs_failed_unnotified_idx
  on public.background_jobs (completed_at)
  where status = 'failed' and failure_notified_at is null;
