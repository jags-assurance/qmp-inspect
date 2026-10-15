# Audit: ITP lifecycle (read-only, 2026-10-14)

Scope: apps/web/lib/itps/*, lib/itp-master/*, lib/ai/*, app/inspect/itps/*, live DB (project qbappyddqdnbwbhbzwei, read-only SQL).
Depth note: traced status machine, submit/review chain/approve/accept/return/revision/withdraw/AI draft/translate/PDF. Bulk import, offline xlsx round trip, Word/Excel export, master library UI were only spot-checked (see UNVERIFIED).

## What works (verified)
- DB status guard trigger `itps_guard_status_transition` allows only draft->under_review, under_review->approved|draft, approved->client_accepted, client_accepted->approved, and any live state -> superseded|withdrawn. Superseded/withdrawn are terminal at DB level. Matches app NEXT_STATUS map (lib/itps/actions.ts:1124).
- Submit (advanceItpStatusAction, actions.ts:1142): blocks empty ITP (needs >=1 activity), org workflow-config reviewer/approver restriction, optimistic status check (`.eq("status", fromStatus)`), segregation of duties (preparer/submitter cannot approve; Admin override audited as self_approved).
- Review chain (review-chain.ts, review-chain-actions.ts): snapshot per ITP, project chain plus per-ITP override, strict order, next reviewer notified, SoD, archive of rounds to itp_review_progress_history, self-heal when last step approved but finalize failed (review-chain-actions.ts ~L305), Admin reassign for deactivated reviewer (reassignReviewStepAction L452), Admin on-behalf signing recorded in signed_by.
- Return to draft (actions.ts:1543): reason required, only current reviewer/Admin, archives chain, notifies preparer/submitter.
- Accept: accept_itp RPC (SECURITY DEFINER) checks org access, pending revision approval, assigned acceptor still active, linked client login; error text surfaces to UI (actions.ts:1636). Admin can reassign/clear acceptor (L1714).
- Revisions: edits to approved/client_accepted ITPs bump revision via bumpRevisionIfIssued (revisions.ts:102) from add/bulk/edit/delete/move/intervention actions; revision approval with SoD, re-acceptance reset to approved, client notified (actions.ts:1423). Live: 0 ITPs with accepted revision mismatch, 0 stuck revision_needs_approval.
- Withdraw/supersede (lifecycle-actions.ts): reason required, replacement must be same project and not withdrawn, audit + notify, optimistic update; excluded from Data Book readiness (databook/readiness.ts:184). Live: 0 superseded without replacement. Draft delete limited to never-submitted rev 0 drafts.
- Master library: copy/propose staff-only; proposal review, master edit/retire, default levels Admin-only (itp-master/actions.ts:49,274,360,682; admin-actions.ts:32,79). Live: 18 master templates, proposals 1 approved / 1 rejected.
- AI draft (ai-draft-actions.ts:53): consent/gate check (assertAiAllowed), unusable-extraction message, provider errors caught and mapped via aiErrorMessage, cache, usage logging, number suggestion best effort, submitted draft re-sanitised before insert (normaliseSubmittedDraft L~215). Translate (actions.ts:1879): fixed language allow-list, gate, errors returned, stored with source revision.
- PDF: requestItpPdfAction queues job; UI polls, shows failed/timeout text and Regenerate (itp-pdf-button.tsx); stale-PDF toast exists.
- Live data: 18 draft, 2 under_review, 18 approved, 12 client_accepted; no superseded/withdrawn yet (those exits never exercised in live data).

## Findings

### Critical
None found.

### High
H1. Approved ITPs on projects with no client login cannot reach client_accepted. accept_itp only allows a linked active client-party login (or the assigned acceptor); there is no staff or "accept on behalf" path and recordExternalApprovalAction (actions.ts:1794) only stores a reference, it does not change status. Live SQL: 13 of 18 `approved` ITPs sit on projects with no active client party with a user_id. Effect: stuck at approved indefinitely; anything gated on client_accepted (if any) is blocked. Also no warning is shown at approval time that nobody can accept. Fix size: M (Admin "record acceptance on behalf, with evidence" action + approval-time warning). Confirm whether downstream inspection/IRN gating requires client_accepted: UNVERIFIED.
H2. Read-only for superseded/withdrawn (and locking while under_review) is not enforced server-side. isTerminalItpStatus is used only in lifecycle-actions.ts and databook/readiness.ts (grep). add/edit/delete/move/setIntervention/bulk actions (actions.ts:266-1000) contain no terminal-status check, bumpRevisionIfIssued ignores superseded/withdrawn (revisions.ts:127) and returns bumped:false without error, and there are NO triggers on itp_items / itp_sections (SQL: none) while RLS policies only check staff or client-creator, not status. A staff user (or direct POST) can silently change content of a withdrawn/superseded ITP, or of an ITP under review mid-chain without revision tracking. Fix size: M (guard helper in every content action + DB trigger on itp_items/itp_sections).
H3. Approval side effects are swallowed after the status already changed. In advanceItpStatusAction the whole post-approval block (snapshotInitialIssue, checklist tick, checklist generation, client notification) is inside one try/catch with an empty catch (actions.ts ~L1295-1400); snapshotInitialIssue (revisions.ts:73-92) does not even check the insert error. A failure leaves an approved ITP with no revision-0 baseline and no client notification, with no notice to the approver (only checklist errors are surfaced). Same pattern in approveItpRevisionAction: snapshotApprovedRevision / client_accepted->approved reset failure is swallowed (actions.ts ~L1470), so a changed revision can stay client_accepted without re-acceptance. Live: 19 approved/accepted ITPs have no itp_revisions row (0 approved since 2026-09-25, so legacy, but nothing heals it except the next edit). Fix size: S-M.

### Medium
M1. Withdraw/supersede is JAGS staff only (lifecycle-actions.ts:32), not permission/Admin gated, and has no check that replacement is itself not superseded or that no open inspections/IRNs/NCRs exist on the withdrawn ITP; effect on open inspections is UNVERIFIED. Possible chain A->B->A. Fix size: S-M.
M2. Review chain start ignores write errors: startReviewChainForItp deletes then inserts steps without checking errors (review-chain.ts ~L170-185). If insert fails the ITP is under_review with no chain and the code treats it as "no chain" (single-click approve by any staff), silently bypassing the configured hierarchy. Fix size: S.
M3. Chain members are never validated at submit time: a reviewer who has lost access/is inactive only gets caught when they try to act (approveReviewStepAction check is on access_grants only, "any grant at all", not org-specific). No proactive notice to Admin/submitter; ITP waits silently. Reassign exists but nobody is told to use it. Live: 0 inactive chain members today, 0 pending steps. Fix size: S-M.
M4. Empty chain edge: if the project chain is empty and the org workflow config names a required approver who is later deactivated, only an Admin can approve (actions.ts ~L1185-1215); no UI hint. Fix size: S. (Not reproduced live.)
M5. Master library create/copy is staff-only (itp-master/actions.ts:49); self-managed client creators (is_client_itp_creator) can create manual/AI ITPs but not from templates. Check against docs: UNVERIFIED which is documented. Fix size: S if intended to open.
M6. Offline xlsx round trip (offline-revision-actions.ts:198,283) and AI draft are gated by isJagsStaff only / AI gate; client self-managed creators cannot use offline revisions. Behaviour vs guide: UNVERIFIED. Fix size: S.
M7. ITP PDF request has no in-flight de-duplication (requestItpPdfAction, lib/reports/actions.ts:297) unlike the inspection-report one (L411): repeated clicks or two users queue duplicate renders; no server-side retry for failed jobs besides manual Regenerate. Fix size: S.

### Low
L1. Translation: only French offered (actions.ts "TRANSLATION_LANGUAGES"); only title and scope are translated, not activities/criteria. Docs claim of "translations" scope: UNVERIFIED. Size S-L depending on intent.
L2. generateItpDraftAction (ai-draft-actions.ts:53) has no explicit role check; relies on RLS project read plus assertAiAllowed, so any project member (including external viewers) who can open the page can spend AI budget; also a failed cache/log write (logAiUsage) failure handling not verified. Size S.
L3. returnItpToDraft deletes the chain after archiving with no error check (actions.ts ~L1591); if delete fails stale pending steps persist into resubmission (startReviewChain clears them again, so low impact).
L4. Superseded/withdrawn paths never exercised in live data (0 rows): untested in production data; recommend a UAT run. Size S.

## UNVERIFIED
- Bulk import (bulk-import.ts), Word export (docx.ts, export-docx route), Excel exports and uncontrolled-copy watermark, ITP register filters/sort/print, master proposal UI approval-to-template merge, itp-master version history: not traced end to end.
- Worker `render_itp_pdf` job failure handling (worker/dist/jobs/itpTemplate.js) and retry policy; I only reviewed the web side.
- Whether downstream modules (inspections, IRN, readiness, handover) require client_accepted vs approved, which sets true severity of H1.
- RLS behaviour per role was read from policy text only; no begin...rollback role tests run.
