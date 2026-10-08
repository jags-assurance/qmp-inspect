# Remaining work: current state of `dev`

Everything described as "done" here is merged on `dev` and passes typecheck and unit tests (web 1059, worker 198).
**None of it has been run against the live database or in a browser.** Nothing in this file has been applied for you.
The previous version of this file is kept at `docs/fixes/wip/REMAINING-before-2026-10-08.md`.

Parked on purpose (not in this file): connectors, email-to-vault, billing and plan limits, MFA and SSO.

## A. What you must do (in this order)

1. **Back up the database.**
2. **Reconcile migration history** (`docs/MIGRATION_REPAIR.md` for the rules; commands in `docs/fixes/MIGRATION_REPAIR_COMMANDS.md`, SQL in `supabase/manual/record_legacy_migrations.sql`). 7 duplicate versions, 30 non-numeric files (not 31).
   No file is renamed. Do this before the first `db push`.
3. **Apply every migration from the earlier batches that is not yet live** (check `supabase migration list` and the list in `docs/fixes/stage-7-6.md`, `stage-5-4.md`; the Phase 6 to 8 files `20261108…`, `20261111…`, `20261112…`).
4. **Apply the new migrations, one file at a time, in this order** (all idempotent, all forward-only):

   | File | What it does | Check after |
   |---|---|---|
   | `20261118000100_projects_update_guard` | Inspectors can no longer update projects; non-admins limited to the details columns | An inspector's project update is refused; edit project details as admin and as a self-managed client |
   | `20261118000200_ncrs_request_id` | Unique `(project_id, request_id)` on `ncrs` replaces the storage-marker duplicate guard | Submit one NCR twice with the same request id: one row |
   | `20261118000300_revoke_trigger_function_execute` | Local record of the live revoke; revokes EXECUTE on every trigger function | None needed |
   | `20261118000400_revoke_internal_function_execute` | Revokes EXECUTE from signed-in users on 15 internal helpers | Raise an NCR, complete an inspection, close a project, issue a handover |
   | `20261118000500_project_party_type_limit` | Database cap on active parties per type (same numbers as `party-limits.ts`) | Add the 11th client party to a project: refused |
   | `20261120000100_inspection_comments` | Comment threads table and guards | Post, reply, resolve on a completed inspection |
   | `20261121000100_audit_trail_pdf_job` | Allows the audit-trail PDF job type | Request the PDF from the project audit log |
   | `20261122000100_background_jobs_failure_notified_at` | Exactly-once failed-job alert; stamps existing failed jobs so no burst | Force a job to fail its last attempt: one admin notification |
   | `20261123000100_register_stats_aggregate` | `register_stats()` for the NCR and Observation stat cards | Counts match the previous page |
   | `20261123000200_audit_log_facets` | `audit_log_facets()` and two indexes | Filter options list all categories and people |
   | `20261123000300_vault_one_approved_per_reference` | `vault_approve_document()`, reordered generated-document filer, unique index | See the note below |
   | `20261124000100_list_query_indexes` | Three `created_at desc` indexes for list pages | None needed |

   **Vault index:** it is created only if no reference has two approved copies. If it raises the NOTICE
   "NOT created", run the duplicate query in the file header, resolve them (nothing is deleted by the migration), and re-run it.
   Order matters for `…0300_revoke_trigger_function_execute` and `…0400`: run after the earlier guard migrations exist.

   The web app and worker work before these are applied (each new path falls back to the old behaviour).
5. **Redeploy the Railway worker** (failed-job alerts, per-project packs, audit-trail PDF). The web app enforces the CSP now; set `CSP_REPORT_ONLY=1` to revert it without a code change.
6. **Test with real sessions** (admin, inspector, client, subcontractor): sign in, raise and close an NCR, complete an inspection, bulk issue IRNs, export the audit log, approve a vault document revision, open the project list, switch the language to Arabic, upload one iPhone HEIC photo in Chrome.
7. **Decisions only you can make:**
   - **`extract-zip` (2 high findings, `pnpm audit --prod`)**: no patched release; it is used only when puppeteer downloads Chrome. Removing it needs puppeteer 25, which drops `networkidle0` (used by all 11 PDF jobs). Decide whether to take that change and test the PDFs.
   - **`heic-to` is LGPL-3.0.** Confirm that is acceptable.
   - **Arabic wording** needs a native-speaker review.
   - **Project packs now file into each project's vault by default** (`FILE_PROJECT_PACKS_IN_PROJECT_VAULTS=false` turns it off). The org-wide pack is still filed only with `FILE_ORG_PACKS_IN_PROJECT_VAULTS=true`.
8. **Test data:** the `[UI-TEST]` data is untouched. The new e2e write specs only create `E2E-` records, run only with `E2E_ALLOW_WRITES=1`, and the cleanup script is a dry run unless `E2E_CLEANUP_CONFIRM=1`.

## B. Done on `dev` this round

| Item | Notes |
|---|---|
| Per-project report packs | Fan-out after the org pack; no-activity projects skipped; one project's failure does not stop the others; cross-project rows are dropped in aggregation |
| Reviewer comment threads | Table, RLS, guard trigger, actions, UI on completed inspections |
| Bulk IRN issue | Shares the single-issue gates; up to 50; per-item results |
| Audit-trail export | CSV (streamed, no row cap) and PDF job (capped at 5000 events, banner when cut) |
| Admin alert for failed jobs | Exactly once per job, scrubbed error summary, never throws into the job loop |
| Arabic strings | Extended `lib/i18n`; sign-in, dashboards, projects list, shared components. Server-action errors and PDFs stay English |
| HEIC conversion | Lazy `heic-to`, only when the browser cannot decode |
| Party-type limit in the database | Trigger on insert and type change; reactivation not capped (same as the app) |
| Closed badge, skeletons | 20 new `loading.tsx` |
| `projects_u` too wide | Staff-wide update closed; column guard added |
| Offline same-item conflict | Three holes fixed: baseline chained before removal, new answers queue behind pending ones, row adopts the synced baseline |
| Provisioning linking any account | Already fixed in the tree before this round |
| 46 callable functions | Reviewed against `.rpc()` calls and RLS policy use; 15 internal-only helpers revoked. Run the query in the migration header on the live database to catch anything created from the dashboard |
| CSP | Enforced; a stricter no-`unsafe-eval` variant is sent Report-Only in production |
| Dependencies | 22 findings to 2 (see A7) |
| Atomic duplicate guard for offline NCR/observation | `request_id` unique index replaces storage markers |
| One approved vault copy per reference | Atomic approve-and-retire RPC and reordered filer |
| Stat-card aggregates | SQL aggregate for NCR and Observation registers; audit facets by `DISTINCT`. Not cached: the aggregate is cheap and RLS-scoped |
| Missing `revoke_trigger_function_execute` file | Written; behaviour matches the name, compare with the live definition |
| Tests | 255 gated RLS write-guard checks plus an offline coverage table (`packages/rls-tests/GUARD_COVERAGE.md`); server-action tests for NCR reopen, project close, IRN, offline-sync replays, `request_id`; gated Playwright write specs and cleanup script |

## C. Not done or not verified

- **k6 load test and baselines:** not run (there is no staging project, so a run would hit the real one). `load-tests/BASELINES.md` is an empty template; the scripts now refuse to run without `LOAD_TEST_CONFIRM_TARGET`.
- **Playwright write specs and the rls-tests write suite** have never run against a real project; expect selector adjustments on the first run. The rls-tests suite was validated against a local Postgres with a request shim (255/255, and it failed with 28 checks when four guards were removed).
- **Usage page under-counts beyond 1000 rows** (`organisation/usage/page.tsx` reads `ai_usage_log` and `background_jobs` with a plain `.select()`); `fetchAll` exists for this. Found, not fixed.
- **`projects_self_managed_client_update`** lets any user with org access on a self-managed or client-managed organisation update the descriptive project columns. The column guard limits it to those columns; confirm that is intended.
- **29 guard coverage gaps** listed in `GUARD_COVERAGE.md` with reasons (last-admin triggers, register guards, some write-policy tables).
- **Migration `20260923030000` references `itp_master_revisions`**, which no earlier file creates, so a from-scratch replay of the migration chain fails there. The live database has it from a hand-run script.
- **Dry-run for a failed-job re-alert:** if the web app resets a failed job to `pending` for a manual retry, a second terminal failure of the same job will not alert again (the `failure_notified_at` stamp stays).
- Open items from earlier stages that I did not touch or re-check: see the previous version of this file (Stage 5/4, Stage 3/2, Stage 1 lists).
