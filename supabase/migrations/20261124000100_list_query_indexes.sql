-- Perf: indexes for three list queries that filter or sort on a column nothing indexes. Idempotent,
-- additive, no data change. Found by reading every list page's query against the indexes the migrations
-- already create (see load-tests/BASELINES.md, "Likely slow list queries"); each plan below was checked on
-- a local Postgres 16 with synthetic data (300k NCRs, 400k ai_usage_log rows, 300k background_jobs rows).
--
--   1. ncrs (created_at desc)                  NCR register (/inspect/ncrs) and Observations (/inspect/observations)
--        select ... from ncrs where severity <> 'observation' [or = 'observation']
--        order by created_at desc range(offset, offset + 24)
--      With no project filter (the default for Admins and org-wide users) the existing
--      ncrs_project_created_idx (project_id, created_at desc) cannot give newest-first order across
--      projects, so Postgres reads and sorts every visible NCR to return 25 rows. This is the same gap
--      20261111000102 closed for inspection_records_date_idx. A project-filtered view keeps using
--      ncrs_project_created_idx.
--   2. ai_usage_log (created_at desc)          Usage & cost page (/inspect/organisation/usage)
--        select ... from ai_usage_log where created_at >= now() - 30 days
--      Only organization_id / user_id / project_id are indexed, so the 30-day window is a full table scan
--      of a table that gains a row for every AI call and is never pruned.
--   3. background_jobs (created_at desc)       same page, same window
--        select ... from background_jobs where created_at >= now() - 30 days
--      background_jobs_status_idx leads with status, the other indexes are partial on one status or job
--      type, so the window is a full scan of the job queue history.
--
-- Not added on purpose (judged not clear-cut): notifications ordering (its page also runs count: 'exact',
-- which scans the user's rows whatever the index), itps (created_at) (a register in the hundreds), and
-- trigram indexes for the register search boxes (ilike '%q%' needs pg_trgm; an extension decision, not an
-- index fix).
--
-- Plain CREATE INDEX (a migration runs in a transaction, so not CONCURRENTLY): it holds a short write lock
-- on each table while it builds. All three tables are append-mostly and small enough that this is
-- sub-second; apply in a quiet minute rather than during a bulk import all the same.

create index if not exists ncrs_created_idx
  on public.ncrs (created_at desc);

create index if not exists ai_usage_log_created_idx
  on public.ai_usage_log (created_at desc);

create index if not exists background_jobs_created_idx
  on public.background_jobs (created_at desc);
