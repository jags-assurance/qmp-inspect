# Stage 7 (Data Book / handover / close) and Stage 6 (release documents) fixes

Branch: `worktree-agent-a0db15ced699f67e2` (based on dev @ 3ff3964). Migrations: `20261101000100`, `20261101000200`, `20261101000300`.
Every code path that needs a new DB object falls back to the previous behaviour until the migration is applied.

## Findings

| ID | Status | What changed | Notes |
|---|---|---|---|
| S7-01 | FIXED | `can_read_handover()` + `handover_certificates_select`, `data_books_select`, storage `handover/` select (migration 100). | Staff on the project + client-role grants only. Contractors/TPI lose read access to books and certificates (the page already redirected them). Custom-permission readers: DEFERRED (no `view_handover` key exists). |
| S7-02 | FIXED | `issue_data_book_handover` stores `p_notes`, honours `p_certificate_number`, else project-scoped `HC-###` via `next_document_sequence`; app passes both (`lib/handover/actions.ts`, form). | Duplicate number on a project -> 23505 message. |
| S7-03 | FIXED | Issue queues the issued Data Book PDF; worker hashes it and freezes path + SHA-256 on the certificate (`rendered_book_*`), shown on the portal and verify page (`renderDataBookPdf.ts`, `certificate-pdf.ts`). | The staff-uploaded package is still the certified artefact; the book PDF is now frozen at issue. |
| S7-04 | FIXED | `requestDataBookPdfAction` reuses only a render completed after the certificate was created. | |
| S7-05 | FIXED | `withdraw_data_book()` RPC, guard allows compiled -> draft only through it, admin action + form (`withdraw-databook-form.tsx`). | Needs migration 100. |
| S7-06 | FIXED | New gates "ITP activities inspected and passed" and "Hold and witness points signed off" in web readiness, worker readiness, panel, gates list. | Latest fail / no record = not ready. Unreleased holds block. |
| S7-07 | FIXED | `fetchAllRows` throws on error; punch count error throws; compile/issue/page fail closed. | |
| S7-08 | FIXED | Same as S6-01. | |
| S7-09 | FIXED | `compile_data_book()` RPC (staff, override=admin, gates subset), guard blocks direct draft -> compiled. Issue RPC re-applies gates. | DB gates are a subset (project completed, open punch, open NCRs, unapproved ITPs); register/IRN categories remain app-computed. |
| S7-10 | FIXED (Phase 6) | Issue RPC checks the package object exists and is non-empty; `issueHandoverAction` now streams the stored object back from Storage, re-hashes it server-side (`lib/handover/package-hash.ts`) and refuses on mismatch / empty / unreadable (fails closed). The server-computed hash is what is stored and audited. | Done in the web action (no worker/edge job needed); packages over 1 GB are refused. No migration. |
| S7-11 | FIXED (Phase 6) | Override compile and withdraw stay admin-only; a conditional issue needs an Admin or JAGS staff holding the new `issue_handover` custom permission (migration `20261108000101`, app `PERMISSION_KEYS`, issue action, RPC). | Admin-grantable only (not in the self-managed client allow-list). Routine issue is unchanged. |
| S7-12 | FIXED | Issue re-runs the compile rule incl. project status; conditional snapshot refreshed (to empty when resolved). | |
| S7-13 | FIXED | `buildOverrideItems` and the compile preview page through `fetchAll`. | |
| S7-14 | FIXED | Per job-type timeout (Data Book 20 min, packs 8 min, default 3). | `Promise.race` still cannot cancel; abort flag already guards side effects. |
| S7-15 | FIXED | Certificate queue only skips when a PENDING job exists; page shows "as of", stale-after-acknowledgement notice, staff Regenerate always. | |
| S7-16 | FIXED | Restrictive `background_jobs` insert policy for Data Book jobs; certificate renders are de-duplicated by content hash so spam adds no vault revisions. | |
| S7-17 | FIXED | `acknowledge_handover` v2: admin needs project access; only `client` role counts (aligned with the app). | |
| S7-18 | PARTIAL (Phase 6) | IP, user-agent, comment, on-behalf basis (required in app) stored; confirm dialog. NEW: client can reject a package with a reason (`reject_handover`, migration `20261108000102`; final for that certificate; blocks acknowledgement; notifies issuer + responsible person; Admin can reopen a rejection made in error). NEW: worker reminder sweep (first nudge after 3 days, then weekly, max 4; issuer told on the last). | NEW (Phase 8): signature pad (the shared `SignaturePad`) and optional evidence file on the acknowledge form, stored on the certificate (`ack_signature`, `ack_evidence_*`, migration `20261112000101`; storage prefix `generated-documents/handover-ack/<book>/`); signature + evidence name shown on the certificate PDF. The signature is required in the app for the client's own acceptance (not enforced in the database, so an older app build keeps working); optional for an admin acting on the client's behalf. |
| S7-19 | FIXED | `revision_reason`/`supersedes_data_book_id`; issuing supersedes the earlier certificate and its vault copies; revision form requires a reason. | |
| S7-20 | FIXED | `close_project` min reason + audit row; lock extended to registers and ITPs; reopen-after-issue audit + banner on the Data Book page. | |
| S7-21 | PARTIAL | Chunked incremental SHA-256, original filename kept in notes, ASCII storage key, progress text; file bytes no longer posted through the server action. | NEW (Phase 8): dependency-free TUS client (`lib/storage/resumable-upload.ts`) for files over 6 MB in the vault upload form and the handover package upload; resyncs from the server offset after a failed chunk; falls back to the ordinary upload if the resumable endpoint is unreachable or refuses. Cross-reload resume is not implemented (storage paths carry a timestamp). Optional env `NEXT_PUBLIC_SUPABASE_RESUMABLE_URL` overrides the endpoint. |
| S7-22 | FIXED | Cleanup via service role (when configured) / new delete policy; insert policy requires a compiled book. | |
| S7-23 | FIXED | Confirm dialogs (type the book number) for compile and issue; acknowledge confirm. | |
| S7-24 | FIXED | UTC-labelled formatting on handover page and Data Book page. | |
| S7-25 | PARTIAL | Pagination, status/number filter, module-licence check, link to Data Book, open-item cap. | Readiness caching / partial realtime refresh not done. |
| S7-26 | PARTIAL | Public QR verification page + token + `verify_document()`; MANIFEST.csv with SHA-256 in the zip. | NEW (Phase 8): email transmittal of an approved vault document or issued Data Book (link, not the file) to up to 10 recipients with a per-recipient log (migration `20261112000102`, `document_transmittals` + extended `email_outbox`; worker retries). Audit-trail export still DEFERRED. |
| S6-01 | FIXED | `issueIrnAction` looks only at live IRNs; `issue_irn()` RPC. | |
| S6-02 | FIXED | `vault_documents_guard_immutable`: approved -> superseded only by staff, approvers, or with an approved replacement of the same reference. | |
| S6-03 | FIXED | `nixpacks.toml` Noto core/CJK/emoji/UI + Amiri; `unicode-bidi: plaintext` injected into every rendered document (`bidi.ts`). | Equivalent to `dir="auto"` on cells without editing 11 templates. Needs a worker redeploy to install fonts. |
| S6-04 | FIXED | download-all pages the query, `maxDuration = 300`, parallel prefetch, MANIFEST.csv, `_NOT_INCLUDED.txt` states an early stop. | HTTP status cannot change after streaming starts; the zip says so. |
| S6-05 | FIXED | `reopen_inspection()` supersedes filed report + IRN docs; NCR reopen supersedes dossier + close-out. | Stale marker on the page: inspection report button shows it; NCR page not changed. |
| S6-06 | FIXED | Worker renders VOID copies; void/reopen queue one. | VOID copy is not filed in the vault (job result only). |
| S6-07 | FIXED (Phase 6) | Inspection and FAT report photos are downscaled (longest edge 1600 px, JPEG 0.8) in the shared Chromium via canvas before inlining (`worker/src/jobs/photoDownscale.ts`); falls back to the original bytes on any failure. Per-photo download cap raised to 20 MB; the 48 MB / 60-photo caps now count the downscaled bytes. | Verified against real Chrome (2.3 MB PNG -> 0.5 MB JPEG). Needs a worker redeploy. |
| S6-08 | FIXED | Void needs admin/team lead; reopen is one transaction (RPC) and the legacy path checks the void result. | |
| S6-09 | FIXED | Content-hash tag in the generated path; identical regeneration returns the existing file. | |
| S6-10 | FIXED | Non-staff / non-approver renders are filed `for_review`, never `approved` (`canFileApproved`). | Requests themselves stay open to members (download need). |
| S6-11 | FIXED | Monthly/weekly pack storage policies require org-wide/global grant or staff. | |
| S6-12 | PARTIAL (Phase 6) | Claim window 60 + fresh-first; orphans requeued under the attempt limit; queue failures surfaced on issue; raw errors hidden. NEW: the backoff is persisted in `background_jobs.retry_not_before` (migration `20261108000103`) and honoured when claiming, so restarts/replicas respect it; falls back to the old behaviour until applied. | Worker-side notification of failed jobs not added. |
| S6-13 | FIXED | `issue_irn()` allocates and inserts atomically. | |
| S6-14 | FIXED (Phase 6) | Inspection report: stale badge vs sign-off, no Generate before completion. NEW: NCR PDF button warns when the NCR changed after the PDF was queued (`ncrs.updated_at`); IRN certificate button warns when the inspection was re-signed after it (`isPdfStale`, 5 s tolerance). | |
| S6-15 | FIXED | Tab opened only after the PDF is ready; poll window 5 min. | |
| S6-16 | FIXED | `sanitizeZipSegment`. | |
| S6-17 | FIXED | Upload removed when filing fails; identical dossier reused. | |
| S6-18 | PARTIAL | QR on IRN + certificate, verify page, manifest. | NEW (Phase 8): email transmittals (see S7-26) and retention rules: org retention period + daily worker sweep that FLAGS documents past it for review, never deleting or changing them (migration `20261112000103`). Digital PDF signatures and bulk IRN issue still DEFERRED (scaffold: `verify_document`, tokens). |
| D-06 | FIXED | Same as S6-04. | |
| E-11 | FIXED | PDF/package/handover links 600 s. | Other surfaces untouched. |
| F-02 | NOT MINE | Lives in `lib/notifications` / `worker/src/automation.ts`; only `notifyMany` in handover now awaits its emails. | Agent D. |

## MANUAL STEPS

1. Before migrating, run (should return no rows you do not expect):
   - `select project_id, count(*) from data_books where status <> 'issued' group by 1 having count(*) > 1;`
   - `select count(*) from handover_certificates where package_storage_path is null;`
2. Apply in order: `20261101000100_handover_access_and_issue_rpc.sql`, `20261101000200_vault_jobs_storage_hardening.sql`, `20261101000300_project_close_irn_reopen_verify.sql`. (100 and 200 depend on `has_org_wide_access` from 20261005090000.)
3. Confirm after applying: `select proname from pg_proc where proname in ('compile_data_book','withdraw_data_book','issue_irn','reopen_inspection','verify_document','can_read_handover');` returns 6 rows; `select count(*) from irns where verification_token is null;` is 0.
4. Deploy the web app and the worker. The worker needs a **Railway rebuild** (new apt fonts in `nixpacks.toml`, new `qrcode` dependency; lockfile updated).
5. Env: set `NEXT_PUBLIC_APP_URL` on the worker service as `PUBLIC_APP_URL` (or `NEXT_PUBLIC_APP_URL`) so QR codes carry the public URL. Without it no QR is printed. Optional: `SUPABASE_SERVICE_ROLE_KEY` on Vercel enables orphan-package cleanup before the delete policy is relied on.
6. Decisions: who may read books/certificates (now staff + client only); whether contractors should keep Data Book read access (would need a narrower policy); add an `issue_handover` / `view_handover` custom permission (RBAC migration).
7. Smoke test: issue an IRN, void it, issue the replacement; re-open an inspection; compile -> withdraw -> compile; issue a handover with a blank reference (expect `HC-001`); open the verify link from the certificate card; download the vault pack and check `MANIFEST.csv`.
