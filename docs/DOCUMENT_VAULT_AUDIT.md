# Document Vault filing audit (Phase 3, part 1)

Scope: how generated documents reach `vault_folders` / `vault_documents`, what the Data Book contains,
and what is missing against the client requirement ("Document Vault organised automatically; generated
reports filed in an organised way; the Data Book contains all generated reports and activities in
detail"). The client's exact Data Book layout document has NOT been provided; nothing below invents one.

## 1. How filing works today

All auto-filing is done by the **worker**, not by `apps/web/lib/*`. The web app only uploads manual
documents (`lib/vault/actions.ts`), supersedes records on re-open (`lib/vault/supersede-refs.ts`,
`irn-void.ts`) and reads.

* `worker/src/jobs/vaultAutoFile.ts` `autoFileVaultDocument()` resolves the project's category folder by
  `(project_id, folder_key)` (re-creating a default one if missing) and calls the atomic RPC
  `vault_file_generated_document` (migration `20261018S6B00001`; multi-step fallback if not deployed).
  Revision is computed per `(folder, document_reference)`; a new APPROVED revision supersedes lower
  numeric revisions (`status='superseded'`, `superseded_by`).
* Folders are the **fixed, flat per-project set** of 12 categories (+ user "custom categories",
  `is_custom`). There is **no nesting** (no parent folder) and no discipline/ITP/activity level.
  Many callers rely on `folder_key` (e.g. `checklists_forms` for evidence linking, `drawings`), which
  is why nested physical folders were not introduced (see section 3).
* Files live in the `generated-documents` bucket, stored as `generated-documents:<path>`, unique path per
  generation (`buildGeneratedPath`: `<prefix>/<base>-rev<N>-h<hash>-<ts>.pdf`). Identical source content
  is not re-filed (`findFiledByHash`).
* Approval: only staff / approvers (`canFileApproved`) cause an `approved` copy; everyone else's render is
  `for_review`. Whole-project zip (`app/api/vault/[projectId]/download-all`) ships `approved` only; non-staff
  can only download approved documents. Unchanged by this work.

## 2. Per document type (state BEFORE this change)

| Document | Auto-filed? | Folder | Title / `document_reference` | Revision / status | Notes |
|---|---|---|---|---|---|
| Inspection report PDF (`renderInspectionReportPdf`) | Yes, once `overall_result` is set | Checklists & Forms | `Inspection Report <record_number> — <activity>` / `<record_number>` | numeric rev (next per reference); approved if requester staff/approver else for_review | **One reference per attempt** (each re-inspection is a new `inspection_records` row with its own number). Nothing marked a failed attempt as superseded when a later one passed, so failed + passing reports were all `approved`. No attempt letter, no discipline/ITP/activity path. |
| IRN PDF (`renderIrnPdf`) | Yes (live IRNs; void copy is rendered, not filed) | Certificates | `Inspection Release Note <irn> — <activity>` / `<irn_number>` | numeric rev; approved/for_review as above | Voiding an IRN supersedes the filed copy (`irn-void.ts`). |
| Checklist / inspection record | No separate document: the inspection report IS the filed output of the checklist execution. Checklist item evidence uploads are manual vault links (`item-document-actions.ts`). | (Checklists & Forms) | - | - | The checklist response data itself is only in the DB and inside the report PDF. |
| ITP PDF (`renderItpPdf`) | Yes, only when ITP is issued | ITPs (Approved) | `<itp_number> — <title>` / `<itp_number>` | keeps ITP revision (`keepRevision`); `for_review` while a revision awaits approval | Draft / returned ITPs are not filed. |
| NCR dossier (`renderNcrPdf`) | Yes | Approvals & Correspondence | `NCR <no>` / `<ncr_number>` | auto-revision; approved only when NCR closed | Re-opening an NCR supersedes the filed copy (`ncrs/actions.ts`). |
| NCR close-out certificate | Yes, closed NCRs only | Certificates | `NCR <no> — Close-out certificate` / `<no>-closeout` | rev per reference | |
| Test certificates | **Not generated.** Materials/calibration/welder certificates are register rows with a `certificate_reference` text; the certificate files are manual uploads. FAT/standalone report is generated (`renderFatReportPdf`) and filed to **Test Reports** (`<assignment_number>`) only when the assignment is completed. | Test Reports | `fatTitle` / `<assignment_number>` | | |
| Data Book PDF | Yes, when status = issued (not on reprint) | Certificates | `Data Book <no> — <title>` / `<book_number>` | keeps `data_books.revision` | Frozen/hashed on issue (`dataBookFreeze.ts`). |
| Handover certificate PDF | Yes | Certificates | `Handover Certificate <no>` | | |
| Weekly/monthly project report packs | Yes (project-scoped, on by default) | General Reference | pack title | auto-revision | Org-wide packs: off by default. |
| Audit trail PDF | **No** (rendered for download only) | - | - | - | |

Metadata stored per filed document before this change: title, document_reference, revision, status,
storage_path, file_size, uploaded_by, created_at. No discipline, ITP, activity, attempt or source-record id
(only the record number embedded in `document_reference`).

## 3. What the Data Book contains today

`worker/src/jobs/renderDataBookPdf.ts` + `dataBookTemplate.ts` render ONE PDF **register**:
cover/control pages, master record register (one row per ITP activity), per-ITP pages (activity, interventions
and sign-offs, record number, result, date, inspector, IRN number, state), materials, welding, calibration,
personnel, standalone/FAT summary, NCR register (with root cause / corrective action / evidence count), punch
list, readiness gates, certification and acceptance.

Findings versus "all generated reports and activities in detail":

1. The Data Book does **not embed or attach** the generated reports. It lists record/IRN **numbers**; the
   inspection report PDFs, IRNs, NCR dossiers, ITP PDFs, FAT reports are separate vault documents. The only
   assembled "pack" of files is the manual whole-project zip (`download-all`), which is not Data-Book aware.
2. Per activity it showed the **newest** inspection record, not the final **passing** one, and said nothing
   about earlier failed attempts (re-inspection history was invisible; only first-time-pass statistics existed in
   the discipline breakdown). **Fixed here** (section 4).
3. No cross-reference from a Data Book row to the vault document (folder, revision, file) that evidences it.
4. Only issued ITPs are listed; audit trail and checklist-level responses (item by item) are not in the book.
5. Test certificates for materials/calibration are text references, not linked vault documents.
6. Handover package (`lib/handover`) hashes a browser-assembled package; its contents are not derived from
   the vault by the server.

## 4. What was changed in this branch (`phase3-vault-filing`)

* **Attempt logic** (pure, tested): `apps/web/lib/checklists/attempts.ts` (note: this file did not exist; it
  was created) mirrored by `worker/src/jobs/vaultFiling.ts` (the worker cannot import web code; KEEP IN SYNC).
  Attempt A/B/C... = creation order of `inspection_records` for the same ITP activity (not `revision`, which
  is a prior-count that can repeat on a double click).
* **Deterministic path** project > discipline > ITP > activity (`buildFilingPath`), stored in the new nullable
  column `vault_documents.filing_path` (migration FILE `supabase/migrations/20261018S6B00002_vault_documents_filing_path.sql`,
  **not applied**). Written best-effort by `autoFileVaultDocument` (`filingPath` param); silently skipped until the column
  exists. Applied to inspection reports and IRNs. Unassigned discipline files under "Unassigned discipline".
  Physical nested `vault_folders` were deliberately NOT introduced: `folder_key` is relied on by evidence-linking,
  zip, retention, transmittals and `(project_id, folder_key)` is unique; nesting needs a UI + policy pass.
* **Naming**: inspection report title is now `Inspection Report <record_number> — Attempt <L> (<Result>) — <activity>`;
  storage base `<record_number>-attempt<L>`. `document_reference` (= record number) and revision numbering are unchanged.
* **Superseded-by-pass**: when an APPROVED passing (`pass`/`partial`) report is filed, the activity's earlier FAILED
  attempts' approved reports are set `superseded` with `superseded_by` = the passing document (same mechanism as
  revision supersede; never deleted; guard allows approved -> superseded). Best-effort, logged on failure.
* **Zip layout**: `download-all` places documents with a `filing_path` under `<Category>/<discipline>/<ITP>/<activity>/`
  (falls back to the category folder when absent). Approval/download restrictions untouched.
* **Data Book**: per activity now presents the **final passing attempt** (newest attempt while none passed), shows the
  attempt letter and "N earlier failed attempts", and appends **"Appendix — Earlier failed inspection attempts"**
  (ITP/point, attempt, record, date, inspector, result, superseded-by record). The appendix and TOC entry appear only
  when earlier failures exist. Readiness math is unchanged (already "latest pass/partial").

## 5. Remaining gaps / blocked

Blocked on the client's Data Book layout (not provided; do not invent): the order and grouping of the book,
whether reports are embedded/merged into one PDF or attached as an indexed package, per-activity detail depth
(checklist item responses, photos), how appendices are organised, and naming of the exported package.

Not blocked, not done in this part: link Data Book rows to vault documents (needs source-record id on documents);
file the ITP / NCR / FAT docs with `filing_path` (only inspection report + IRN done); generate or link test
certificates; file the audit-trail PDF; supersede failed-attempt reports when the passing report is approved
LATER by a human (currently only at render time by an approver/staff); retro-fill `filing_path` for already-filed
documents; DB-backed tests for the supersede query (only pure logic is unit tested; none of this was run against a
database or the worker end to end).
