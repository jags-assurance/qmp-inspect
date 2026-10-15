# Audit: Documents and Closeout (read-only)

Date: 2026-10-14. Scope: Document Vault, generated documents (worker PDF jobs), registers, Data Book, handover, verification page, project close.
Method: code trace (UI -> server action -> RPC/RLS/trigger -> worker) plus read-only SQL on project qbappyddqdnbwbhbzwei. No code, data or schema was changed.
Fix size key: S = under half a day, M = 1-3 days, L = a week or more.

## Verdict

The core closeout chain (vault upload and approve, register gates, Data Book compile, issue, acknowledge, reject, reopen, certificate PDF, verification page) is implemented end to end and is mostly enforced in the database, not just the UI. There are no Critical findings. Three High items stop it being "complete": email delivery to real recipients is currently blocked, the multi-approver rule is not enforced in the database, and the public verification page calls a rejected certificate genuine. Connectors and cloud sync are stubs.

Counts: Critical 0, High 3, Medium 12, Low 10 (25 findings), plus UNVERIFIED items listed at the end.

## What works (verified)

- Data Book state machine is guarded in the DB. `data_books_guard` trigger allows draft -> compiled only via `compile_data_book()`, compiled -> draft only via `withdraw_data_book()`, compiled -> issued only via `issue_data_book_handover()`, and makes an issued book fully immutable. Live DB has all RPCs, all SECURITY DEFINER. (`pg_get_functiondef` on each; apps/web/lib/databook/actions.ts, lib/handover/actions.ts)
- Issue fails closed. It re-runs readiness server-side, requires a documented override for a conditional handover, restricts conditional issue to Admin or the `issue_handover` permission (app and RPC both), re-hashes the stored package server-side, verifies the object exists and is non-empty, and removes the orphan upload on failure. (lib/handover/actions.ts:115-313; RPC `issue_data_book_handover`)
- Issue supersedes the previous certificate and approved vault copies of earlier book/certificate references in the same transaction.
- Acknowledge, reject and reopen are RPC-enforced: client role only (admin on behalf requires a recorded basis), single-shot, blocked once superseded or rejected, evidence path must sit under the book's folder and exist in storage. Reject needs 10+ chars, reopen is admin only. (RPC bodies read; lib/handover/actions.ts:325-640)
- Acknowledgement reminders (3 days, then weekly, capped) and register expiry alerts (deduped per item, expiry date and threshold) run in the worker. (worker/src/automation.ts:365-660; `register_expiry_notifications` has 3 rows live)
- Vault: revisions auto-increment, approved copy stays current until the new revision is approved, approved/superseded rows are immutable (`vault_documents_guard_immutable`), generated documents can only be filed by the system (`vault_documents_guard_insert`), non-approvers always insert as `for_review`, reject needs a reason and is limited to approver/admin/permission holders. Whole-project zip contains approved documents only, non-staff selections are limited to approved, with MANIFEST.csv SHA-256 and `_NOT_INCLUDED.txt`. (lib/vault/*.ts, app/api/vault/[projectId]/download-all/route.ts)
- `background_jobs` has RESTRICTIVE insert policies (`requested_by` must equal the caller; Data Book renders staff-only; certificate variant needs `can_read_handover`), so a user cannot queue arbitrary job types.
- Job queue: atomic claim RPC with SKIP LOCKED, durable backoff, 3 attempts, per-type timeouts, orphan reclaim that requeues, once-only failure alerts (`failure_notified_at`). Live `background_jobs`: 0 pending, 0 stuck in processing, 0 failed without a failure notification. All failures are historical (see L7). (worker/src/jobs/queue.ts, jobFailureAlert.ts)
- Generated renders de-duplicate by content hash, so an unchanged IRN/certificate does not mint a new controlled revision; a failed filing deletes the uploaded object. (worker/src/jobs/generatedDocument.ts)
- Public verify page returns only number, status, date, hash (no project/party/user data), token is 2x UUID hex (256 bits) so it is not guessable, input length/charset checked in `verify_document`. (app/verify/[kind]/[token]/page.tsx)
- Registers: add is limited to staff and project contributors by RLS and action; edit/verify/delete/lifecycle are staff-only; certificate download goes through RLS plus a 5-minute signed URL. (RLS on 4 register tables; lib/registers/*)
- Project completion is guarded by `projects_status_guard` (open NCR, punch, draft inspections, unissued books, ITP revisions) with `close_project()` as an admin-only reasoned override. (SQL)

## PENDING / BROKEN

### High

**H1. Verification page certifies a REJECTED certificate as genuine.** `verify_document('certificate')` computes status only from `superseded_at` and `acknowledged_at`; `rejected_at` is ignored. A client-rejected certificate (which cannot be acknowledged and is meant to be reissued) shows "This document is genuine / Issued - awaiting acknowledgement". Evidence: function body via `pg_get_functiondef('public.verify_document')`; app/verify/[kind]/[token]/page.tsx:60-70 has no rejected state. Fix S (add `rejected` status in the function and the page text).

**H2. Email to real recipients is not deliverable right now.** The only transmittal on record failed with Resend 403 "You can only send testing emails to your own email address ... verify a domain". Outbox: 573 skipped, 1 sent, 1 failed (5 attempts). Impact: transmittals, handover and acknowledgement emails, job-failure alert emails and register-expiry emails reach nobody except the owner address. In-app notifications still work. Evidence: `document_transmittals.last_error` and `email_outbox` SQL. Fix S (verify sending domain in Resend and set sender), then re-test; email-inbound is also unproven (H2 prerequisite, see U2).

**H3. Multi-approver rule is enforced only in the app, not the database.** `vault_documents_guard_approval` lets any one named approver, admin or approve-permission holder move a document to `approved`; it never checks that all rows in `vault_document_approvers` are approved. `vault_documents_update` RLS lets any project member update rows, and `vault_approve_document` is SECURITY INVOKER with no approver check. So one approver (or an admin, who is not blocked when a list exists) can approve alone through the REST API even when two sign-offs are required. Also `vault_document_approvers_update` lets any JAGS staff set another person's approver row to approved. Evidence: both function bodies; policies on `vault_document_approvers`; app check at lib/vault/multi-approval-actions.ts:152-188 is the only gate. Fix M (check in trigger or RPC that every approver row is approved, and block direct status writes).

### Medium

**M1. DB readiness gate is much weaker than the readiness the UI shows.** `data_book_gate_failures()` checks only project status, open punch, open NCRs and ITP approval. The TypeScript readiness (and the worker copy) also gate calibration, welder, personnel, material, IRN coverage, checklists, hold/witness points and standalone assignments. `compile_data_book` and `issue_data_book_handover` call only the DB function, so a JAGS staff user calling the RPC directly can compile and issue a non-override book with expired calibrations or unsigned hold points. The app server action does re-check (lib/databook/actions.ts:159-184, lib/handover/actions.ts:180-202), so normal UI use is safe. Fix M (port the missing categories into the SQL function). Related: the readiness logic is duplicated in apps/web/lib/databook/readiness.ts and worker/src/jobs/renderDataBookPdf.ts:70-230 ("KEEP IN SYNC" comments) and will drift. Fix L to unify.

**M2. "Frozen at issue" Data Book is re-rendered from live data.** The issued-book PDF is built at render time from current NCRs, punch items, ITPs and registers (only register expiry uses the issue date as `asOf`). The hash stored on the certificate is that of the FIRST render, which happens asynchronously after issue and again after any retry. A retry hours later, or a change between issue and render, yields a book that differs from the state certified. Evidence: worker/src/jobs/renderDataBookPdf.ts:1000-1030 and buildDataBookHtml (live `gatherDataBookContent`). Fix L (snapshot content at issue, or render inside the issue transaction window).

**M3. Vault storage objects are readable and listable by any project member regardless of document status, and cannot be cleaned up.** Policies `inspection_evidence_vault_select/insert` grant project-wide access to `vault/<project>/...`. Drafts, rejected and for-review files are fetchable by clients and subcontractors by path or list, even though the download zip and UI restrict them. There is no storage delete policy for `vault/` (the generic delete policy matches only `<projectId>/...`), and `uploadVaultDocumentCore` does not remove the uploaded object when the row insert fails (lib/vault/actions.ts:165-167), so a failed record save orphans the file forever. The email path does clean up (route.ts:230-233). Fix M. UI-side exposure of for_review rows to clients is UNVERIFIED (RLS allows it).

**M4. One sequential worker; a Data Book render can stall everything.** `pollOnce` awaits one job at a time (worker/src/index.ts:287-288). A multi-pass Data Book has a 20 minute budget (retryPolicy.ts:42) and during that time no IRN, certificate or NCR PDF runs, and the same loop also hosts orphan reclaim, failure-alert sweep, transmittal and notification outbox, retention and the reminder sweep. Fix M (separate loop for sweeps, or a second replica; the claim RPC already supports multiple replicas).

**M5. Transmittal emails carry a link, not the document.** Recipients need an account with project access; external parties (the normal recipients of a transmittal) cannot open it. Documented in lib/transmittals/actions.ts:90-91. Fix M (attach file or time-limited signed link).

**M6. External connectors and cloud sync are stubs.** Aconex, Procore, ProjectWise: `isConfigured()` env checks only, UI says "not available yet" (app/inspect/vault/connectors-panel.tsx:20-25). Cloud folder sync stores a folder reference and nothing reads it (only lib/cloud-sync/actions.ts and gate.ts reference `cloud_folder_sync_configs`; no worker code). Fix L, or hide until built.

**M7. Retention has no completion step.** `review_retention_flag` records `keep` or `dispose_approved` but nothing disposes or archives (the sweep "never deletes" by design). A documented approval to dispose therefore does nothing. Retention is also not configured live (0 `org_retention_settings`, 0 flags), so the sweep is unproven. Fix M (define disposal/archive action) or label as review-only.

**M8. Register contributors cannot correct or renew their own entries.** Add is allowed for contractor/subcontractor/TPI contributors, but edit, replace certificate, delete, verify and recalibrate are staff-only (lib/registers/manage-actions.ts:55-56; UPDATE/DELETE RLS is `is_jags_staff()`). A typo or a renewed certificate needs JAGS staff each time. Fix S/M (allow contributors to edit or replace unverified rows they created).

**M9. Project close and Data Book ordering is circular.** `projects_status_guard` refuses completion while any data book is not issued; compile and issue require the project to be Completed or an override. Creating a draft book before completion forces `close_project()` with a reason, and the compile of a clean book still needs the project Completed first. The working order (complete project, then create/compile/issue) is not stated in the UI. Evidence: guard body, lib/databook/actions.ts:171-185. Fix S (UI guidance, or ignore draft books in the guard).

**M10. Email-to-vault sender check trusts the From header.** Allowlist is party contact emails, linked users and an env list (route.ts:143-166); From is spoofable unless the provider enforces SPF/DKIM. The project UUID in the address is the only other secret. Documents land as `for_review`, which limits the blast radius. Feature has never been used live (0 `inbound_email_messages`). Fix S (require provider authentication result or a per-project secret in the address).

**M11. No segregation of duties on vault approval.** Nothing prevents the uploader from approving their own document if they are an Admin or hold the permission (approveDocumentAction and the trigger do not compare `uploaded_by` with the approver). Fix S.

**M12. Several generated documents are never filed in the vault.** Audit trail PDF, portfolio summary, weekly and monthly report packs are uploaded to storage and referenced only by the job row (no `autoFileVaultDocument`/`uploadAndFile` in those 5 job files). They have no revision control, no retention, and are found only through the job result. Fix M.

### Low

- **L1.** Four legacy certificates have no `rendered_book_sha256`/path: HC-ATL-001, UITEST-CERT-001, HC-E2E-001, HC-20261007-000196C4 (SQL). Their verify page shows no Data Book fingerprint. Fix S (backfill or mark legacy).
- **L2.** Handover "awaiting acknowledgement" filter is `acknowledged_at is null`, so it also lists rejected and superseded certificates (app/inspect/handover/page.tsx:93-95). Fix S.
- **L3.** Rejection does not queue a certificate re-render, so the filed certificate PDF and its QR page never show a rejected state (only acknowledge re-queues, lib/handover/actions.ts:459). Fix S.
- **L4.** A job that exceeds its timeout is marked failed immediately with no retry, unlike other transient errors (worker/src/index.ts:216-222). Fix S.
- **L5.** Best-effort writes swallow errors: audit events, notifications and `recordRenderedPdfHash` log a warning only (lib/handover/actions.ts catch blocks; worker/src/jobs/integritySeal.ts:33-42). A missing PDF hash silently disables the file checker on the verify page. Fix S (alert or retry).
- **L6.** Pre-migration fallback branches remain (direct `data_books` update, 3-step acknowledge RPC fallback, claim CAS fallback). The live DB has every RPC, so they are dead code today, and the DB trigger would block the direct update anyway. Fix S (remove).
- **L7.** Historical job failures, all alerted: 18 `render_itp_pdf` orphaned by worker restarts (Sep 12 onward), 2 `generate_weekly_report_pack` "Unknown job_type" (worker older than web, 2026-09-17), 1 monthly pack "Could not find Chrome" (2026-09-10), 1 inspection report orphaned (2026-09-26). No recurrence since; shows deploy-order and Chrome-install risk. Fix S (deploy order note).
- **L8.** All 7 calibration rows have no certificate file attached; a certificate is not required to add a calibration entry. Fix S (optional requirement).
- **L9.** Vault documents cannot be deleted (no DELETE policy); a wrong upload can only be rejected or superseded. Probably intended for document control; confirm. Fix S.
- **L10.** `issue_data_book_handover` accepts a NULL package hash and does not verify the stored object hash itself (only the web action does, lib/handover/actions.ts:230); a staff user calling the RPC directly can issue with an unverified package. Fix S.

## UNVERIFIED (not exercised live or not readable)

- U1. Retention sweep and review: no org has retention enabled, so the sweep and the review UI were not exercised.
- U2. Email-inbound ingestion: 0 messages; needs provider secret, `SUPABASE_SERVICE_ROLE_KEY` and `VAULT_EMAIL_WEBHOOK_SECRET` on the deployed app, not visible from here.
- U3. Real Chromium rendering on the production worker: DB shows recent completed renders for every job type (latest Oct 13), but worker logs and Railway state were not read.
- U4. Whether the web UI hides for_review/rejected vault rows from client users (RLS allows reading them).
- U5. Markup viewer and revision-compare screens (drawing-markup-viewer.tsx, compare/page.tsx) were not traced beyond file presence.
- U6. CSV import for registers (lib/registers/csv-import.ts, import-actions.ts) and AI extract panels were located but not traced to the insert.
- U7. Production env: `NEXT_PUBLIC_APP_URL`, Resend sender and Sentry DSN values.

## Top 10

1. H1: verify page shows a rejected handover certificate as genuine.
2. H2: Resend domain unverified, so transmittals and all non-owner emails fail (live failure recorded).
3. H3: multi-approver vault approval is not enforced in the database.
4. M1: DB compile/issue gate checks only 4 of 11 readiness categories.
5. M2: issued Data Book is rendered from live data, not frozen at issue.
6. M3: vault files readable by any project member by path, and orphaned on failed save.
7. M4: single sequential worker; a 20 minute Data Book render blocks all jobs and sweeps.
8. M5: transmittals email a login-gated link, unusable for external recipients.
9. M6: Aconex/Procore/ProjectWise connectors and cloud sync are stubs.
10. M8: register contributors cannot correct or renew their own entries.
