# Per-request database work: audit

Scope: the pages a normal session touches. Motivation: the shared dev Supabase instance stops answering
health checks and sign-in takes 60-90 s after a few minutes of one-user traffic.

Counting rules: "queries" are PostgREST/RPC round trips to Postgres made while rendering the page,
not counting the `proxy.ts` Auth call (listed separately) or Storage calls. `≥1` means a `fetchAll`
that pages at 1000 rows. "Before" is this branch's parent; "After" is this branch. Numbers are for the
usual path; conditional extras are in the notes.

RLS column: **fn/row** = the table's policies call `has_project_access` / `has_org_access` /
`is_jags_staff` (all `SECURITY DEFINER`, never inlined) once per row the query touches, and once more
per row of every embedded table. That covers almost every table in this schema (projects, itps,
itp_items, ncrs, punch_list_items, inspection_records, project_parties, vault_*, audit_log, registers),
so every unbounded read below pays it per row. `users`, `notifications` and `access_grants` reads are
own-row policies (no helper per row).

## Cross-cutting (every request)

| Where | Queries | Notes |
|---|---|---|
| `proxy.ts` | 1 Auth-server call (`auth.getUser`) per non-prefetch request; **0 for prefetches (new)** | The profile `users` query only runs when the JWT lacks the `must_change_password` claim and the signed `qmp_chk` cookie is stale (5 min); it is skipped on prefetches. Inactivity/abs-lifetime use the signed `qmp_seen` cookie (no network). MFA assurance level is a local JWT decode and only when MFA is on. Before this change every `<Link>` prefetch also paid an Auth round trip. |
| `app/inspect/layout.tsx` (full load, `router.refresh()`) | admin 2, inspector 3, client login 3-5 | `getSessionContext` (cached per request): `getClaims` (local JWKS verify, no DB) + `users` + `access_grants`. Inspector adds `team_members`. Client adds `client_teams` head count; org chrome (2 min) and licence map (60 s) are `unstable_cache`d. |
| Notifications bell (streamed in the shell) | **before 2, after 1** (2 only when the user has ≥20 notifications) | List of latest 20 plus a true unread count. When fewer than 20 rows come back the list is the whole inbox, so the count is taken from it. Realtime INSERT/UPDATE on `notifications` only patches client state; it never refreshes the page. |

Every `router.refresh()` re-runs the layout and the bell on top of the page, so the cost of a refresh is
layout + page. That is why the realtime guard below matters.

## Page table

| Page | Queries before | Queries after | Unbounded / N+1 | RLS fn/row | What changed |
|---|---|---|---|---|---|
| `/inspect` Admin | 16-17 | 13-14 | `projects` and open `ncrs` are `fetchAll`ed in full (open NCRs with an embedded `projects`: 2 policy evaluations per NCR); `expiring` reads every lapsed register row ever (3 `fetchAll`s) | yes (ncrs, projects, audit_log, registers) | Dropped 3 queries the Admin view never rendered: `project_parties`, `ncrs` head count (total = length of the rows already fetched) and `ncrs` assigned-to-me. |
| `/inspect` Inspector | 20 | 16 | `checklist_templates` (limit 20) with a 5-level embed; `expiring` as above; `loadAssignedToMe` re-read archived ids and ran at render time after everything else | yes | Skipped `organizations`, open-NCR count and `project_parties` (unused by this view); archived-template ids read once per request (React `cache`); assigned-to-me starts in parallel with the rest. |
| `/inspect` External (client / contractor / TPI) | 14-19 | 13-18 | main-contractor review chain is 3-4 dependent queries; `expiring` | yes | Org-health widget (self-managed clients): two head counts on `project_parties` became one light query. |
| Projects list | 6-7 | 5-6 (7 only when `?org=` set) | all visible projects, plus flat `itps` / `ncrs` / `punch` rows for every visible project (silently capped at 1000 by PostgREST) | yes | The org-filter dropdown re-queried `projects`; it is now built from the rows already loaded. |
| Project hub (overview tab) | 4 + 9 base (+5-12 conditional, in 4-5 sequential stages) | 3 + 6 base (same conditionals, 2 fewer stages) | project row read 2-3 times (hub, overview, geofence); party members / eligible users read after a serial chain | yes | Tab badges: 3 head counts became 2 light row queries whose numbers are handed to the overview, which no longer re-counts NCRs/punch. Overview project, geofence and counts now start together. |
| Project hub (other tabs) | hub 4 + view | hub 3 + view | project row read again by every view | yes | Same badge change. |
| Inspections list | 5 (`?irn=none`: up to 15 with ≤10 *sequential* IRN chunks) | 5 (`irn=none`: chunks in parallel) | `projects` dropdown unbounded; `irn=none` window of 2000 ids | yes (inspection_records + `irns!inner`) | N+1-style chunk loop is now one parallel batch. |
| NCR register | 3-4 (+1 per 1000 matching rows) | unchanged | stats `fetchAll` over every matching NCR (light columns) | yes | Already reduced to one light stats query in the parent commit. Realtime: see below. |
| Observation register | 6 | 2 (+1 per 1000 rows, +1 with a discipline filter) | stats rows unbounded (light) | yes | 4 head counts + an open-ages query on the same table became one light query. |
| Punch list (hub tab / route) | 10-11 | 8 | outstanding rows capped at 1000; closed windowed | yes (+ embedded `project_parties`) | `open` and `resolved` head counts are counted from the already-loaded outstanding rows; the exact counts only run if that list hit its cap. |
| Registers | 11 + one UPDATE per stale row, in 7 sequential stages | 11 + ≤3-9 grouped UPDATEs, 4 stages | `refreshRegisterStatuses` reads every row of 3 registers on every staff view; per-row UPDATE N+1 | yes | Write-back is grouped (one UPDATE per distinct new status, chunked) and runs alongside the page reads; timezone, party members and holder names no longer wait on each other. |
| Vault landing | 5+ (+1 non-admin) | unchanged | every non-superseded document row id for the project (`fetchAll`, 3 columns) to count per folder | yes | Not changed: needs a per-folder count RPC/view (see "Not done"). |
| Vault folder | 7-10 | 6-9 | documents windowed (100) + review queue (500) | yes | Permission check ‖ folder; approver parties ‖ staff users. |
| Handover | 4 + serial licence lookups | 4 | `background_jobs` filtered on `payload->>…` with no index | yes (embedded 4 levels) | Licence checks in parallel; new partial expression index on `background_jobs` (migration). |
| Start work | 8, assigned-to-me serial at the end | 7, assigned-to-me parallel | up to 1000 templates with a 4-level embed, 5000 inspection records, up to 1000 ids in one `.in()` URL | yes | Archived-id read deduped; assigned-to-me parallel. Large reads left (behaviour-bound). |
| Notifications page | 2 | 2 | paginated | no | Unchanged. |

## Realtime refresh (`components/domain/realtime-refresh.tsx`, `lib/realtime/refresh-scheduler.ts`)

Uses: NCR register (`ncrs`, unfiltered), checklist execution (`checklist_responses`, unfiltered), handover
(`handover_certificates`, unfiltered), ITP detail (`activity_signoff_progress` unfiltered + `itps`), NCR
detail, vault folder/document, data book, KPIs, punch list, standalone.

Findings: the existing scheduler debounced bursts (1.5 s) but a continuous stream still refreshed every
6 s, a refresh was started even when the previous one was still rendering (on a slow database these stack
and each re-runs layout + page), and the ITP page mounted two components, i.e. two schedulers, so one
burst gave two refreshes.

Changes: (1) hard minimum of 5 s between refreshes; (2) no new refresh while the previous one is still in
flight (tracked with a transition; the pending event is retried, not dropped; 30 s fail-safe); (3)
`also` lets one component watch several tables on one scheduler/channel (ITP page uses it). Hidden-tab
handling is unchanged. The bell does not use `router.refresh()`.

Left as is: `checklist_responses` and `ncrs` are subscribed without a row filter (no single equality
column fits the page). Each event is also RLS-checked by Realtime per subscriber.

## Database helper functions (`20261116000101_rls_helper_perf.sql`)

Before: `has_org_access` / `has_project_access` / `has_org_wide_access` were `SECURITY DEFINER` SQL
functions that called `auth_user_is_usable()` (another `SECURITY DEFINER` function that reads
`public.users`) and then ran the `access_grants` query. Per evaluated row: 2 function invocations (each
with a `search_path` save/restore, never inlined), 2 sub-queries.

After: one function invocation and one statement per row. The usability test is a join to `public.users`
in the same query as the grant lookup, and `auth.uid()` is `(select auth.uid())` inside every helper.
Same signatures, `stable`, `security definer`, search_path and grants. Also a plain
`access_grants(user_id)` index. `auth_user_is_usable()` itself is kept (other code may call it).

Semantics: identical. Missing user row, `is_active` false/null or `must_change_password` true/null all
return false, as `coalesce(..., false)` did.

Not done, and why: wrapping helper calls inside the policies as `(select …)`. Only the argument-less
helpers (`is_jags_staff()`, `is_admin_staff()`, `auth_user_is_usable()`) can become an initplan; the
argument-taking ones cannot (their arguments are columns). Rewriting several hundred policy expressions
is not something to ship without a database to check the generated policies against; a regexp rewrite of
`pg_policies` risks double-wrapping already-wrapped calls. The helper change above removes the nested
call, which was the larger per-row cost.

## Not done (candidates, in order of expected payoff)

1. Dashboard Admin: replace the two `fetchAll`s (all active projects, all open NCRs with a joined project)
   with one grouped SQL function returning per-project/org counts.
2. `getExpiringRegisterItems`: reads every lapsed row ever across all projects on each dashboard view;
   needs a function with a lifecycle filter and a cap.
3. Vault landing per-folder counts via a grouped view/RPC instead of fetching every document id.
4. Start work: server-side filtering by approved ITP instead of a 1000-template embed; chunk the
   `.in("itp_item_id", …)` list (it can exceed URL limits, which would silently return no data).
5. Policy-level `(select …)` wrapping for `is_jags_staff()` / `is_admin_staff()`.
