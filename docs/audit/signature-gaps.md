# Inspection signature gaps (audit site-execution L4)

Read-only SQL, live project qbappyddqdnbwbhbzwei, 2026-10-14. Query: completed inspection_records with
overall_result = 'pass' and (inspector_signature is null or signed_at is null). No data was changed.

Total: 13 passed inspections (plus 4 'fail' results with the same gap, not listed). All 13 also have
signed_by_name and signed_by_user_id null. Test-project pattern: name or project number matches test/demo/e2e/uat or "[".

| Record | Project | Date | Null columns | Test project |
|---|---|---|---|---|
| MER-JAGS-ITP-001-INSP-1 | MER-2026-001 | 2026-09-09 | signed_at | no |
| ATL-JAGS-ITP-001-INSP-1 | ATL-2026-001 | 2026-09-10 | inspector_signature, signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-001-INSP-1 | GSP-PLATFORM-7 | 2026-09-15 | signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-001-INSP-2 | GSP-PLATFORM-7 | 2026-09-15 | signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-006-INSP-2 | GSP-PLATFORM-7 | 2026-09-23 | signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-022-INSP-3 | GSP-PLATFORM-7 | 2026-09-23 | signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-003-INSP-2 | GSP-PLATFORM-7 | 2026-09-25 | signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-2509-INSP-1 | GSP-PLATFORM-7 | 2026-09-25 | signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-2509-INSP-2 | GSP-PLATFORM-7 | 2026-09-25 | signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-007-INSP-1 | GSP-PLATFORM-7 | 2026-09-26 | signed_at | no |
| GSP-PLATFORM-7-JAGS-ITP-007-INSP-3 | GSP-PLATFORM-7 | 2026-09-26 | signed_at | no |
| E2E-001-ITP-001-INSP-1 | E2E-001 | 2026-10-03 | signed_at | yes (E2E Small Pump Skid) |
| GSP-PLATFORM-7-JAGS-ITP-008-INSP-1 | GSP-PLATFORM-7 | 2026-10-05 | signed_at | no |

## Classification
- 12 of 13 HAVE an inspector_signature image but no signed_at / signed-by identity: signed on the pad, but the
  completion stamp was not recorded. Probably completed before the signed_at / signed_by_user_id columns were
  written by the action path (September records), or by a path that skips them. Not name-matched as test data
  (GSP-PLATFORM-7 looks like a UAT/demo project, but the name pattern does not say so).
- 1 (ATL-JAGS-ITP-001-INSP-1) has no signature at all: cannot come from the current action path; legacy/seed data.
- 1 (E2E-001-ITP-001-INSP-1) is on an automated-test project (E2E).
- Recommendation (not applied): decide whether to backfill signed_at from the completion audit event or to leave
  as legacy; re-open and re-sign only if the project is real. The staff-only chip "Completed without a signature
  (legacy)" now flags these on the inspection page (no signature or no signed_at).
