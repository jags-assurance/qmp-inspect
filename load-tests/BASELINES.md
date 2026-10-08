# Load-test baselines

**Status: nothing recorded yet.** No load test has been run (there is no staging project; see `README.md`). The
tables below are the template to fill in after a real run against a dedicated test Supabase project. Do not enter
numbers from the real project, from a laptop-to-cloud run you did not describe, or from a single lucky run.

## How to record

1. Run `k6-load-test.js` three times against the same environment (commands in `README.md`).
2. For every row, write the **median of the three runs** (p50 / p95 / p99 are all in the k6 summary; the script
   requests `p(99)`).
3. Fill in the environment block once per set of runs. A baseline without it is not comparable.
4. Leave failed or aborted runs in the "Run log" with the reason; never silently drop them.
5. When a threshold in `k6-load-test.js` is tightened, note the date and the new bar here.

## Environment (one block per set of runs)

| Field | Value |
|---|---|
| Date | |
| Supabase project (a throwaway test project, never the real one) | |
| Plan / compute size (same as the real project?) | |
| Region (and region of the machine running k6) | |
| Data volume seeded (organisations / projects / NCRs / inspections / audit rows) | |
| Synthetic users (`seed-test-users.mjs` count) | |
| Last migration applied | |
| App git commit under test | |
| k6 version and where it ran | |
| Write scenario enabled (`TEST_INSPECTION_RECORD_ID` set)? | |

## Results

Durations in milliseconds. Error rate is the fraction of failed requests (or logins), as a percentage.

| Scenario | Metric | p50 | p95 | p99 | Error rate | Date | Environment | Threshold | Pass? |
|---|---|---|---|---|---|---|---|---|---|
| `login_stampede` (ramp to 1000 VUs) | `custom_login_duration` | | | | | | | p95 < 2000 | |
| `login_stampede` | `custom_login_failures` | n/a | n/a | n/a | | | | rate < 1% | |
| `steady_state` (300 VUs, 5 iterations each) | `custom_session_read_duration` | | | | | | | p95 < 500 | |
| `steady_state` (write path, optional) | `custom_checklist_write_duration` | | | | | | | none yet | |
| both scenarios | `http_req_duration` (all requests) | | | | | | | none | |
| both scenarios | `http_req_failed` | n/a | n/a | n/a | | | | rate < 2% | |

### Run log

| Date | Environment | Result | Notes (aborted? throttled by Supabase Auth? anything unusual) |
|---|---|---|---|
| | | | |

### Page-level timings (optional, measured by hand or with the e2e suite)

k6 hits the Supabase APIs directly, so it does not time rendered pages. If you also want page numbers, record them
here with the same environment block (browser, network, cold or warm).

| Page | Role | Rows visible | p50 | p95 | Date | Notes |
|---|---|---|---|---|---|---|
| `/inspect/ncrs` | Admin | | | | | |
| `/inspect/inspections` | Admin | | | | | |
| `/inspect/projects/<id>/punch-list` | Inspector | | | | | |
| `/inspect/organisation/usage` | Admin | | | | | |

---

## Likely slow list queries

Found by reading every list page's data query (`apps/web/app/inspect/**/page.tsx`) against the indexes the
migrations create. "Verified" means the plan was checked with `EXPLAIN (ANALYZE)` on a local Postgres 16 with
synthetic data (300k NCRs across 200 projects, 400k `ai_usage_log` rows, 300k `background_jobs` rows); the timings
are local, on an idle laptop-class box, and are **evidence of the plan shape, not production numbers**. Fill the real
numbers in the tables above.

### Fixed by `supabase/migrations/20261124000100_list_query_indexes.sql`

| Page | Query | Problem | Index added | Verified plan (local, synthetic) |
|---|---|---|---|---|
| NCR register `/inspect/ncrs` | `ncrs where severity <> 'observation' order by created_at desc range(...)`, no project filter | `ncrs_project_created_idx (project_id, created_at desc)` cannot order across projects, so every visible NCR is read and sorted for 25 rows. Same gap `inspection_records_date_idx` closed for inspections. | `ncrs_created_idx (created_at desc)` | page 1: parallel seq scan + top-N sort, 34 ms -> index scan, 0.26 ms (page 10: 34 ms -> 2.6 ms) |
| Observations `/inspect/observations` | `ncrs where severity = 'observation' order by created_at desc` | same | same index | 23 ms -> 0.12 ms |
| Usage & cost `/inspect/organisation/usage` | `ai_usage_log where created_at >= now() - 30 days` | no index on `created_at`; table gains a row per AI call and is never pruned | `ai_usage_log_created_idx (created_at desc)` | seq scan 32 ms -> bitmap index scan 15 ms (the rest is returning 17k rows) |
| same page | `background_jobs where created_at >= now() - 30 days` | `background_jobs_status_idx` leads with `status`; the other indexes are partial | `background_jobs_created_idx (created_at desc)` | seq scan 25 ms -> bitmap index scan 10 ms |

### Looked at, not changed (and why)

| Page / query | Existing support | Why left alone |
|---|---|---|
| Punch list, vault folder, inspections list, NCR list **with a project filter** | composite indexes from `20261111000102_list_page_sort_indexes.sql` | already match the `order by` |
| Notifications `/inspect/notifications` (All tab) | `notifications_recipient_idx (recipient_user_id, is_read, created_at desc)` | the middle column stops it ordering the "All" tab, but the page also runs `count: 'exact'` over the same rows, so a better index would not change the cost. Revisit if one user accumulates tens of thousands of notifications (`(recipient_user_id, created_at desc)`). |
| ITP register `/inspect/itps` | `itps_project_id_idx`, `itps_phase_idx` | four `count(*) where status = ?` queries and a `created_at` sort with no index on either; the table is a register in the hundreds-to-low-thousands, so it is not worth an index yet. Add `itps (status)` and `itps (created_at desc)` if it grows. |
| Register search boxes (NCR, observations, ITPs: `ilike '%q%'` on number / description / title) | none possible with btree | a trigram index (`pg_trgm` GIN) is the fix, but that is an extension decision, not an index fix. Suggested: `create extension if not exists pg_trgm with schema extensions; create index ... using gin (description extensions.gin_trgm_ops)` on `ncrs.description`, `ncrs.ncr_number`, `itps.title`, `itps.itp_number`. Only worth it once those registers are large. |
| Dashboards, project hub (`in (project_id...)`, `in (itp_item_id...)`, `activity_signoff_progress` by party + status) | single-column FK indexes exist on every column used | fine at the sizes seen; the `in (...)` lists grow with the number of visible projects, so watch the Admin dashboard first |

### Query-shape risks that no index fixes

These come from the same read-through and are worth a ticket each; none was changed here.

- **Silent 1000-row cap on the usage page.** `organisation/usage/page.tsx` reads `ai_usage_log` and `background_jobs` with a plain
  `.select()` and no `.range()`. Hosted PostgREST stops at 1000 rows without an error, so once a 30-day window holds more than
  1000 AI calls or jobs the totals under-count. `lib/supabase/fetch-all.ts` (`fetchAll`) exists for exactly this. The new indexes
  make the window cheap; they do not fix the cap.
- **Whole-register reads for stat cards.** The NCR and observation registers fall back to paging every matching row
  (`fetchAll`, 1000 per page) when the `register_stats` function is missing; with it applied (`20261123000100`) they use one SQL
  aggregate. Confirm that migration is applied before reading anything into a slow Admin NCR page.
- **Admin dashboards read everything the Admin can see.** `projects/page.tsx`, `reports-documents/page.tsx`, `manage/page.tsx`
  and the dashboard use `in (all visible project ids)` filters with no row limit. RLS (`has_project_access`) runs per row, so
  these scale with the number of projects, not with page size.
- **`count: 'exact'` on large tables** (notifications, ITP register status counts, NCR register) forces a scan of every visible
  row for each page view, behind RLS. A 5-second-stale cached count, or `count: 'estimated'` for the page total, is the usual
  remedy.

### Checking a suspect on a real database

```sql
-- Run as the role the page runs as (an authenticated user), not as postgres, so RLS is in the plan:
set role authenticated;
select set_config('request.jwt.claim.sub', '<user uuid>', false);
explain (analyze, buffers)
select id, ncr_number, severity, status, due_date, created_at
from public.ncrs where severity <> 'observation' order by created_at desc offset 0 limit 25;
```

Look for `Seq Scan` on a large table, a `Sort` above a scan that reads far more rows than it returns, and a
filter/`Rows Removed by Filter` count far larger than the rows returned. Supabase's Database -> Query Performance report
shows the same statements by total time.
