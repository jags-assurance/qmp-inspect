# Re-run B1-B7 and C1-C3 on THP-2026-001 (dev build 2a3bb63, 13 Oct 2026)

Result ITP: **THP-2026-001-JAGS-ITP-001** (id 457041e3-6868-4b1a-8e1e-961c305fa27f), "LV Switchroom Electrical Installation & Testing", Rev 0, status **Client accepted** (accepted by Priya Nair). 14 activities, 27 sign-off points.

| Step | Result | Evidence |
|---|---|---|
| B1 re-upload PDFs | PASS | THP-ES-200 and THP-DWG-E-101 re-uploaded as Rev B (new revision notice, "Yes, upload as new revision"); Rev A marked Superseded; both now "Ready" in the AI picker. Rev B (typed) is kept as typed. |
| B2 Generate draft | PASS (after one 502) | 5 docs ticked (ES-200 B, SPEC, MAT, MS, DWG B), Standard. First click: POST 502 after ~35 s, "Something went wrong". Second try: HTTP 200 in ~5 s, "AI-assisted draft", 4 sections, 15 activities, references cite doc + clause (incl. ES-200 Rev B, DWG-E-101 Rev B). |
| B3 edit and create ITP | PASS | Edited one activity, changed evidence type (Document upload to Measurement record), removed one activity (14 left), Create ITP: landed on ITP page, Draft, "AI-drafted" badge. PLAYBOOK MISMATCH: checklists are not made at once; "Checklists are generated from these activities when the ITP is approved" (to be generated); they exist after approval (CHK-3..CHK-8). |
| B4 H/W/R/S cells | PASS | AI pre-filled grid. Set TPI H and JAGS/GFL H on earth electrode, client and Voltway W on functional test, R/S on others; reloaded values persisted; cells show Pending; legend shown. Planned date / Notice hrs: NOT TESTED (editing after approval would raise a revision). Rapid successive selects were lost twice (re-render race). |
| B5 submit | PASS | Draft -> Under review; review chain panel "1. Ravi Kapoor, 2. Oliver Bennett"; Approval roadmap shows the stages. Reviewer notification: not checked. |
| B6 return and resubmit | PASS (1 flake) | Inspector (Ravi): Return to preparer + reason, first Confirm gave "ITP not found." (transient); second ok. Admin sees status Draft and "Returned for changes: <reason> 13/10/2026 10:00". Resubmit worked on the 3rd try (twice "Add at least one activity before submitting this ITP for review." although 14 exist). Round 2 started. |
| B7 chain approvals | PASS | Ravi "Approve review step 1" -> step 2 "reviewing now"; Oliver "Approve review step 2" -> status Approved, history "Rev 0 - Initial issue - Oliver Bennett". Roadmap: both steps Approved with name+timestamp. "Reviewer must differ from preparer": not tested (admin prepared and approved; documented admin override). UNCONTROLLED COPY on PDF: not tested. |
| C1 client accept | PASS | client@meridian.demo is linked to THP client party (Priya Nair). Dashboard "ITPs awaiting your acceptance" listed the ITP; ticked ack, Accept ITP -> roadmap "Client accepted - Priya Nair - 13/10/2026". Page rendered an error right after the action (500 flake) but state saved. |
| C2 party sign-off | PASS | Contractor (6 own buttons), Subcontractor (5), TPI (3) each had Sign off only on own cells; other cells "Awaiting party" (21/20/23); tooltip "Only this party's own login (or JAGS staff) can sign off". One cell signed per party; roadmap "3 of 27 signed off". |
| C3 notify / re-notify / proceed | PASS | Notify on one Witness cell, then Notify all pending (all 8 Holds became Notified), Re-notify on one cell. After 1 h "Notice period elapsed" on 5 Witness cells; Holds show "Elapsed - still waiting for release" with no Proceed. Button is labelled "Proceed" and asks a reason (playbook says "Proceed without response"); result badge "Proceeded (no response)". The toast "Party notified. The notice period is running." was not captured. Witness notice hours were 1 (from earlier A3), restored to 24. |

## Bugs / findings
1. ITP detail page is unreliable on dev: about half of loads return HTTP 500 "Something went wrong" (~7 s, looks like a DB statement timeout surfaced by the new "fail loudly" throws in itp-detail-view.tsx lines 411-412). Other loads render but with the H/W/R/S grid blank, "No project parties configured" or "no checklist-type activities" (parties/other queries swallow errors, itp-detail-view.tsx ~231). Repro: open the ITP repeatedly.
2. Swallowed read errors give misleading action errors: returnItpToDraftAction "ITP not found." (actions.ts:1562) and submit "Add at least one activity..." (actions.ts:1236-1239) when the read times out.
3. Generate draft: first call returned 502 after ~35 s (one occurrence).
4. Checklist preview numbers look doubled ("1.1.2", "2.2.3") for items numbered 1.2, 2.3.
5. Playbook wording: checklists appear at approval not at creation; button "Proceed" not "Proceed without response".

## State left behind
ITP THP-2026-001-JAGS-ITP-001 Client accepted. Checklists THP-2026-001-JAGS-ITP-001-CHK-3.. (CHK-6 has 8 items, CHK-3/4 5 items) generated, no inspections started. Sign-off: 27 points; 3 signed off (contractor, sub, TPI one each), 1 Witness proceeded (no response), others Notified (all 8 Holds Notified, none released). Vault: ES-200 Rev B and DWG-E-101 Rev B added (Rev A superseded).
