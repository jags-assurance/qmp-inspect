# End-to-End Test Procedure

Run on dev/local only. Name test data `E2E-…`. One browser profile per role. Record PASS/FAIL per step.

Roles: A JAGS admin, B JAGS inspector, C client, D main contractor, E subcontractor, F TPI/lab.

## 1. Set-up (A)
1. Settings > Client Organisations: create the client org. Settings > Brand Colors: logo and colours. Settings > Numbering, Intervention Levels.
2. Projects > New project (A only). Expected: project hub opens.
3. Add parties (client, main contractor, subcontractor, TPI). Provision a login for each: the one-time temporary password is shown once after granting. Expected: each party can log in and sees only this project.
4. Add register contributors (party members) if needed.

## 2. ITP (B, then C)
1. ITPs > New ITP (or copy from Master ITP Library). Add activities with H/W/R/S levels per party; set planned dates where needed.
2. Submit through the review chain; approve (staff or `approve_itp` holder). Expected: status Approved.
3. Client accepts the ITP (C). Expected: Client Accepted.

## 3. Clearances and registers (A/B/contributors)
1. Project > Registers: add calibration, welder, personnel, material entries; upload certificates. Expected: Data Book readiness reflects them; expiry alerts later.
2. Standalone clearance record where applicable (Standalone Assignments).

## 4. Site execution (B, D, E)
1. Execute > Start work: pick the activity. Expected: checklist opens (or inspection created).
2. Answer every item; add photos; on an item use **Document** to attach from the vault or upload. Expected: document listed on that item.
3. Hold/witness: give notice; party signs own cell on the intervention grid; B may sign on behalf.
4. Complete. All Yes: Pass. Any No: Fail, which can raise a punch item and NCR.
5. Execute > Inspections: verify the row, filters (including IRN), open the report PDF. Expected: single details table, signature boxes.
6. Pass inspection: B issues IRN. Expected: IRN number, PDF renders.
7. Re-open a completed inspection as staff with a reason: expected amendment recorded in history.

## 5. NCR and punch (B, E, A)
1. Quality > NCRs: raise NCR from a failed item (linked to the checklist item). Expected: matching punch item created.
2. E records root cause, corrective action; verification notes by staff; close. Expected: closing fails until all three are present.
3. Punch list: priority, photos, verification step; close needs admin or `close_punch_item`; re-open works with reason.
4. Raise an Observation (NCR with severity Observation).

## 6. Release documents and Data Book (A/B)
1. Records > Document Vault: upload to a folder, approve (admin or `approve_vault_document`). Expected: approved doc is immutable; new revision supersedes.
2. Project > Data Book: create, view readiness per category, Generate/compile. Expected: refuses while punch items are open unless admin gives a documented override reason.
3. Generate PDF; view and download. Expected: cover, index, sections, revision shown.
4. Issue handover (A/B). Records > Handover: client C acknowledges. Expected: acknowledgement logged.

## 7. Checks that must FAIL
| Check | Role | Expected |
|---|---|---|
| Sign another party's cell | C, D, E, F | Rejected (own cell only) |
| Forge an approval by posting server action for another party | any non-staff | Rejected |
| Issue IRN / release material | D, E | Rejected |
| Create project | B, C, D, E | Rejected |
| Edit a completed inspection without re-open | any | Rejected |
| Re-open without reason | staff | Rejected |
| Replace a voided IRN twice (one live IRN per record) | B | Second live IRN rejected; voided IRN is replaceable once |
| Close NCR without root cause/corrective/verification | A/B | Rejected |
| Close punch item | D, E, C without permission | Rejected |
| Approve vault document | B without permission | Rejected |
| Edit or delete an approved vault document | any | Rejected |
| Compile Data Book with open punch items, no override | B | Rejected; override only A with reason |
| Edit evidence after sign-off | any | Rejected |
| Open another project's URL | party user | Not found/denied |
| Queue org-wide report pack | B | Rejected (admin only) |

## 8. Result log
Copy the list above into a checklist and mark each step PASS/FAIL/NOTE. Remove `E2E-` data afterwards.

See also `docs/E2E_DATABOOK_TEST_PROCEDURE.md` (older Data Book focused script, superseded by section 6 here).

## 9. Automated read-only coverage
`apps/web/e2e` (Playwright) automates the read-only parts of this procedure: login and landing page per role, admin-only page guards, list pages per role and the project -> ITP -> checklist -> inspection -> NCR -> vault -> handover walk. It never mutates data, so the create/submit/sign/close steps above remain manual. See `apps/web/e2e/README.md`; the last recorded run is in `docs/E2E_RUN_RESULTS.md`.
