# Power BI views (phase 4: activity-level detail)

Four row-level views added in `supabase/migrations/20261212000100_phase4_powerbi_activity_views.sql`,
alongside the six per-project roll-ups described in `POWER_BI_CONNECTION.md`. Together they let one
Power BI model report on everything done in the app, down to the single activity.

## Security (same as the existing views)

- Plain views, **not** `security_invoker`, exactly like the existing `vw_powerbi_*` views. The
  `powerbi_reader` login has no Supabase Auth session, so RLS (`has_org_access()`) would hide every
  row if the views ran as the caller.
- Isolation = who may connect as `powerbi_reader` (JAGS-internal staff only). Every view carries
  `organization_id` and `project_id` to slice by client/project.
- `SELECT` is granted to `powerbi_reader` only; the migration explicitly revokes everything from
  `public`, `anon` and `authenticated`. Never grant these views to `authenticated` — they bypass RLS
  (see `20260916140000_grant_powerbi_views_to_authenticated.sql`).
- Read-only. Data is live at query time (DirectQuery) or as of the last refresh (Import).

## How to connect

Follow `POWER_BI_CONNECTION.md` (PostgreSQL connector, `powerbi_reader` credentials). In the
Navigator tick the `vw_powerbi_*` views. Suggested model: use `vw_powerbi_activity_fact` as the
central table (key `itp_item_id`), relate `vw_powerbi_inspection_attempts` and
`vw_powerbi_signoff_turnaround` to it on `itp_item_id` (many-to-one), and relate
`vw_powerbi_databook_completeness` and the older per-project views on `project_id`.

## vw_powerbi_inspection_attempts (one row per inspection record)

`organization_id, project_id, project_number, project_name, itp_id, itp_number, itp_title,
itp_item_id, item_number, activity, inspection_record_id, record_number, revision, attempt_label,
attempt_sequence, overall_result, is_completed, inspector_id, inspector_name, inspection_date,
created_at, is_reinspection, is_failed_attempt, has_issued_irn, failed_then_passed,
later_passed_at, days_to_pass`

- `revision`: per-activity attempt counter (0 = first). `attempt_label` is A, B, C... (`revision` as
  text beyond Z). `attempt_sequence` is an independent 1-based ordering by `created_at`.
- `is_reinspection` = `revision > 0`. Draft records have `overall_result` null and
  `is_completed = false`; filter them out for result analysis.
- `failed_then_passed` / `later_passed_at` / `days_to_pass`: for a `fail` attempt, whether a later
  record on the same activity has `overall_result = 'pass'` (strictly pass, `partial` does not count),
  and the days between the two records' `created_at`. Null for non-failed attempts.
- `inspector_name` is personal data; keep the report internal.

## vw_powerbi_signoff_turnaround (one row per activity x party sign-off)

`organization_id, project_id, project_number, project_name, itp_id, itp_number, itp_item_id,
item_number, activity, signoff_progress_id, project_party_id, party_name, party_type, intervention,
intervention_label, status, notified_at, signed_off_at, proceeded_at, responded_at,
hours_to_signoff, hours_to_proceed, hours_waiting_open, notice_period_hours, is_signed_off,
is_proceeded_no_response`

- `intervention`: H Hold, W Witness, R Review, S Surveillance.
- `signed_off` and `proceeded_no_response` stay distinct: `hours_to_signoff` is only filled for
  `signed_off` rows; `hours_to_proceed` (notified to proceeded) only for `proceeded_no_response`.
  Do not average them together as a "response time".
- `hours_waiting_open`: for `notified` rows, hours since notification up to query time.
- `notice_period_hours`: project override from `notice_period_configs`, else fallback Hold 48 /
  Witness 24; null for R/S.
- Rows never notified have null hours.

## vw_powerbi_databook_completeness (one row per project)

`organization_id, project_id, project_number, project_name, project_status`, then `<category>_ready`
and `<category>_total` for `itps, inspection_records, checklists, calibration, welder, personnel,
material, standalone, ncrs, activities, hold_points`, then `open_punch_items,
handover_certificate_issued, total_ready, total_required, overall_percentage, is_ready`.

Mirrors `computeDataBookReadiness()` (`apps/web/lib/databook/readiness.ts`) and `strictPercentage`
(`readiness-math.ts`): overall = sum ready / sum required across the 11 gating categories, floored,
capped at 99 unless everything is ready, 100 when nothing is required. `is_ready` = every category
ready >= total and zero open punch items. `handover_certificate_issued` is informational, not gating.

What cannot be reproduced in SQL / differs:

- Per-category percentages are not columns; compute `ready/total` in Power BI with the same strict
  rule (100 if total = 0 or ready >= total, else min(99, floor(100*ready/total))).
- Register expiry uses the UTC date at query time (as the app does); an Import snapshot freezes it.
- Manual overrides and the discipline breakdown (`override-items.ts`, `discipline-breakdown.ts`) are
  app-only.
- The app tolerates databases missing newer columns; this view needs the current schema.
- Ties on identical `created_at` are broken by record id (the app uses read order).
- The in-database gate `data_book_gate_failures()` is a separate, smaller rule set and is not used.

## vw_powerbi_activity_fact (one row per ITP activity)

Project/ITP/section: `organization_id, project_id, project_number, project_name, project_status,
itp_id, itp_number, itp_title, itp_status, itp_revision, section_id, section_number, section_title`.
Activity: `itp_item_id, item_number, activity, evidence_type, evidence_type_label, discipline_id,
discipline_code, discipline_name`.
Parties: `parties_count, hold_count, witness_count, review_count, surveillance_count`.
Sign-offs: `signed_off_count, proceeded_no_response_count, notified_open_count, pending_count,
holds_witness_count, holds_signed_count` (`holds_signed_count` follows the Data Book rule: signed
off, or Witness proceeded without response).
Inspections: `attempts_count, completed_attempts_count, failed_attempts_count, max_revision,
latest_inspection_record_id, latest_inspection_result, latest_inspection_date` (latest = latest
completed record).
Evidence: `has_checklist, inspection_photo_count, inspection_evidence_document_count,
item_evidence_document_count, measurement_count, expected_records_count,
expected_records_received_count, evidence_count` (photos + inspection documents + item documents).
Readiness: `is_ready_for_databook` (checklist activity on an approved/client-accepted ITP whose
latest completed inspection is pass/partial).

Child tables are pre-aggregated per activity, so counts are never multiplied by joins.

## Validation status

The SQL was run against a throwaway local Postgres 16 with hand-written stub tables carrying the
columns the views use (syntax, joins, aggregation and grants checked with a small sample). It has
not been run against the real Supabase schema or data; check row counts against the app before
publishing a report.
