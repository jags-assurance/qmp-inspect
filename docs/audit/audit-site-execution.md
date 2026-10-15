# Audit: Site execution (QMP Inspect)

Read-only audit, 2026-10-14. Scope: Start work, assignment, checklist generation, checklist execution, offline queue/sync, notices/waivers, sign-off, completion, IRN, inspection record, comments/review, reopen, standalone FAT/SAT.
Method: code trace (UI -> server action -> DB guard) plus read-only SQL on project qbappyddqdnbwbhbzwei. Not done: no browser walkthrough, no execution of the offline path on a real device, no check of every RLS policy body (UNVERIFIED where stated).

Paths are under apps/web unless noted.

## What works (verified in code)

- Checklist answer save (lib/checklists/actions.ts:497-680): server checks permission (canExecuteItpItem), completed lock, item belongs to checklist, 'No' needs comment, numeric result derived server-side from limits, register/instrument/welder/material gate, optimistic concurrency via expected_updated_at plus conditional update on updated_at.
- DB backs the app rules: inspection_records_write_guard blocks any edit or delete of a completed record except staff reopen; inspection_child_write_guard blocks responses/photos on completed inspections; inspection_child_exec_guard enforces party and item membership (SQL pg_get_functiondef). This closes the save-vs-complete race at DB level.
- Start inspection (actions.ts:715-1009): ITP must be approved, template/activity/project must match, AI drafts blocked until confirmed, released activity (live IRN) cannot be restarted, resumes an existing draft, per-project Hold-blocks-start toggle, atomic numbering with release on failure, 23505 double-start handled.
- Completion (actions.ts:1032-1436): signature validated, evidence required (or written waiver, staff only for fails), mandatory N/A comment, every 'No' needs NCR or reason, Hold gate fails closed, unnotified Witness gate, conditional update `.is(overall_result,null)` makes double submit and offline replay safe; fail creates punch item with fallback notification; pass supersedes earlier failure punch; report PDF job queued.
- IRN issue/void/bulk (actions.ts:1607-1889): party gate, Hold gate, open-NCR gate, one live IRN, atomic issue_irn RPC with fallback, void needs admin/team lead and reason, vault docs superseded, VOID PDF queued. DB trigger irns_issue_gates_guard repeats the gates.
- Sign-off (lib/signoff/actions.ts): sign, reject (reason, returns to pending, notifies), on-behalf with reason (admin/team lead), proceed-without-response (staff, non-blocking only, after notice period), withdraw (blocked while live IRN), sequencing, conditional updates against double click.
- Reopen (lib/checklists/lifecycle-actions.ts): reason, amendment snapshot of answers and signatures, IRN void, transactional RPC with fallback, rollback on failure.
- Offline (lib/offline, app/api/offline-sync/route.ts): idempotency keys, per-inspection ordering, retry budget with backoff, conflict/auth/foreign states with user actions, origin check, shared-device user binding, persist() request, baseline chaining for queued edits, marker to stop a replayed start_inspection from opening a second inspection.
- Standalone (lib/standalone/actions.ts): measurements, photos, signatures, notes, finalize (signature required, reason for conditional/fail, pass blocked by failed or unresolved measurements), conditional_open -> clearance with punch re-check, lifecycle trigger on table, finalize undone if punch item cannot be created.
- Live data sanity: 45 inspection records, 15 live IRNs, 0 empty checklist templates, 0 background jobs stuck over 1 day.

## Findings

### Critical
None found.

### High

H1. No way to discard an abandoned draft inspection (documented but missing).
- reopenInspectionAction (lifecycle-actions.ts:75-77) tells the user "Complete or discard it first", but no discard/delete-draft action or button exists (grep for discard/delete inspection in app and lib: none). DB has a DELETE policy (inspection_records_write_d) and the write guard allows deleting drafts, so only UI/action is missing.
- Live: 15 drafts older than 14 days; 9 of them sit on a checklist that already has a completed record, so those completed inspections cannot be re-opened/amended until the draft is completed (which needs full evidence and signature).
- Fix: S-M. Add "Discard draft" (staff or executing party, reason, audit, remove photos).

H2. Reviewer rejection does not gate anything.
- review-actions.ts header: "does not gate completion or IRN issue". issueIrnForRecord (actions.ts:1627-1787) never reads review_status. A rejected inspection can still get an IRN and feed the Data Book. The only recovery is an admin/team-lead reopen. Decide whether rejection must block IRN issue and the Data Book gate.
- Fix: S (IRN gate) to M (Data Book and notifications).

### Medium

M1. Standalone assignments: a conditional_open assignment cannot be reopened or re-concluded.
- reopenAssignmentAction updates `.eq("status","completed")` only (standalone/actions.ts:1344). If the conditional conclusion was wrong, or the punch item was withdrawn, the only exit is clearance. Admin-only reopen.
- Fix: S (allow conditional_open).

M2. Standalone reopen leaves the linked punch items in place.
- reopenAssignmentAction does not touch the punch items created at finalize (fail / fat_conditional_pass). After a retest passes, stale open punch items remain and can block handover; compare the inspection path, which supersedes failure punches on re-pass (actions.ts:1397-1413). The reason is only in the audit event, not on the record.
- Fix: S-M.

M3. Failed standalone assignment: punch-item creation errors are ignored.
- standalone/actions.ts:1019-1028 does not check the result for `fail` (conditional pass does and rolls back). A fail can finalize with no punch item and no notification.
- Fix: S.

M4. Offline coverage gaps.
- Queue kinds (lib/offline/db.ts:17-26) exclude sign-off, notify party, comments, who-fixes-this assignment (documented "online only", fix-assignment-actions.ts:29), assign activity, standalone finalize/punch/notes. An inspector with no signal can complete an inspection but cannot notify the Witness party, which completion requires (actions.ts:1231), so completion queued offline can be rejected at replay with "Notify the Witness party".
- Fix: M (queue notify) or S (warn in UI before going offline).

M5. Offline sync has no background trigger.
- public/sw.js has no Background Sync; sync runs only while the app is open (sync-client.ts). Items queued over 3 days are only flagged (policy.ts STALE_QUEUE_DAYS); browsers can evict storage (persist() is requested, but not guaranteed). Data-loss risk if the tablet is left closed.
- UNVERIFIED on real devices.
- Fix: M.

M6. One rejected queued item blocks the rest of that inspection.
- sync-client.ts:79-84 holds all later items for the same inspection after one rejected/conflict item, including the completion. Example: a queued vault-document link to a not-yet-approved file is rejected (actions.ts:1947) and keeps photos and completion waiting until the user acts on the banner. Users must notice the banner.
- Fix: S (surface per-inspection badge on Start work and the checklist page) - UNVERIFIED whether one exists.

M7. Completed inspection can only be corrected by JAGS admin/team lead.
- Contractor inspectors cannot request or perform a correction (reopen is staff only, lifecycle-actions.ts:34-61). No "request reopen" action found. Same for IRN void and withdrawing sign-off. Probably intended, but there is no in-app request path.
- Fix: M (request-reopen with notification).

M8. Failed background jobs in live data.
- 22 failed jobs: 18 render_itp_pdf and 1 render_inspection_report_pdf "Orphaned: worker restarted"; 1 monthly report pack "Could not find Chrome"; 2 generate_weekly_report_pack "Unknown job_type" (worker has no handler). Inspection report PDF auto-generation after completion (actions.ts:1417-1433) depends on this worker; a failed job is not retried automatically.
- Fix: S-M (retry orphaned jobs on worker start, add handler or remove weekly job). Worker is outside this audit area, so treat as UNVERIFIED beyond the SQL result.

### Low

L1. proceedWithoutResponseAction does not check ITP approval or lower-level sequencing (signoff/actions.ts:776-876) unlike signOffAction. Fix: S.

L2. startInspectionAction fails open if enforce_hold_blocks_start cannot be read (actions.ts:829-837, `projectSettings?.` undefined skips the check). Completion still enforces the Hold. Fix: S.

L3. DB reopen guard allows any JAGS staff (inspection_records_write_guard, `is_jags_staff()`); the admin/team-lead restriction exists only in the server action. A staff user calling the API directly can reopen. Same pattern for sign-off withdraw. Fix: S-M.

L4. Live data: one completed 'pass' inspection (ATL-JAGS-ITP-001-INSP-1, id 392e5cde-ce0b-4ad9-a524-96e8cb9696f9) has no inspector_signature and no signed_at, which the action path cannot produce. Likely legacy/test data. 2 passed inspections have no live IRN (expected if not yet issued).

L5. Counters like reject_count are read-modify-write (signoff/actions.ts:709-712); cosmetic only.

L6. Sign-off cells: 123 rows in `notified` for more than 7 days and 330 `pending` in live data. Witness can be proceeded by staff; Holds have no overdue escalation beyond the admin overdue-holds panel (app/inspect/admin-overdue-holds.tsx). Not a defect; shows the volume of unreleased points. UNVERIFIED whether these are test data.

L7. 5 AI-generated checklist templates unconfirmed (start blocked by design until staff confirm, actions.ts:765-773). Not a defect; staff must review them.

## Not found (checked)
- No TODO/FIXME markers in apps/web TypeScript on this path. Only the Aconex/Procore/ProjectWise connector stubs (lib/connectors/*) are stubs, outside this area.
- No swallowed errors on the critical writes; best-effort blocks are limited to audit, notifications, PDF jobs.

## Counts
Critical 0, High 2, Medium 8, Low 7.
