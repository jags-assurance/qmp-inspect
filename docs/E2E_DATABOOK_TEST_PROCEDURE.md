> The current, full script is `docs/E2E_TEST_PROCEDURE.md`. This file is kept as a Data Book focused reference.

# End-to-end test: small project → Data Book (draft → final)

Goal: run one small project through every workflow with a different login per party, then generate
the Data Book as **Draft**, **For Review** and **Final** and compare against
`Jags_Assurance_Data_Book_Reference.pdf`. Nothing here is executed yet — this is the procedure to approve first.

## 0. Ground rules
- Run on the **local dev app** (or dev Vercel) against the dev Supabase — never production.
- Test data is clearly named `E2E-…` so it can be found and removed afterwards.
- Logins: use the existing seed accounts for JAGS admin/inspector; party logins are **created by the
  procedure itself** (step 3, "Provision party login") with test-only passwords noted in your own notebook
  — they are not stored in the repo or this file.
- Use one browser profile per role (or private windows) so sessions don't mix.
- Record result of every step as PASS / FAIL / NOTE in the checklist at the bottom.

## 1. Roles used (one login each)
| # | Role | Used for |
|---|------|----------|
| A | JAGS admin | org/branding setup, project setup, approvals, data book compile/issue |
| B | JAGS inspector | field inspections, IRNs, witness/hold sign-offs |
| C | Client party | accepts ITP, client-side H/W/R sign-offs, raises observations |
| D | Main contractor party | executes/sign-offs, reviews subcontractor work |
| E | Subcontractor party | field execution, resolves punch items / NCRs |
| F | TPI / lab party | third-party test records, witness |

## 2. Organisation + second branding (Role A)
1. Settings → Clients (Organisations): create **E2E Client Org** (a second organisation, different from the default).
2. Settings → Branding for that org: upload a logo, set a distinct primary and accent colour (e.g. teal + orange); set engagement mode **co-branded** (then repeat later with **white-label** to compare PDFs).
3. Settings → Intervention levels: confirm H/W/R/S (+ optional custom CQR) with notice hours.
4. Settings → Numbering: note the ITP / NCR / record number formats.
- Expect: dashboard and PDFs show the org's colours/logo; JAGS default org unchanged.

## 3. Project and parties (Role A)
1. Projects → New project: `E2E-001 | E2E Small Pump Skid`, under E2E Client Org.
2. Project → add parties: Client, Main contractor, Subcontractor, TPI/lab (+ JAGS).
3. For each party: **Provision party login** → note the generated email; set a test password through the first-login flow.
4. Project settings: enable "allow contractor ITP creation" **off** for the first pass; set review chain: Reviewer (JAGS) → Approver (JAGS); acceptor: any client party. Set notice periods (H 48h, W 24h).
- Expect: each party login lands on the external-party dashboard with only this project.

## 4. ITP lifecycle (Roles A, C)
1. Create **ITP-001** (3 sections: Material receipt, Fabrication/Welding, Testing & Handover) with ≥8 activities mixing evidence types (Checklist, Measurement record, Document) and disciplines.
2. Per activity set interventions per party: at least one **H**, one **W**, one **R**, one **S**; one activity with a notice-hours override.
3. Open a checklist-type activity → click the **Checklist** pill → confirm the draft checklist shows inline.
4. Draft → Under review (A). Review chain step 1 → step 2 (reviewer ≠ preparer if independence is set). Check the Approval roadmap page: stages turn green with person names; section 3 (H/W/R/S) counts.
5. Approve (A) → expect **Revision 0 "Initial issue"** snapshot; checklists generated.
6. Client party (C) → **Accept** (tick the checklist-reviewed acknowledgement). Expect status Client accepted, name + date on the roadmap.
7. **Revision test:** as A edit an activity → reason required → Rev 1; change one party's H→W → reason required → Rev 2; same-value change → no bump; regenerate PDF → revision unchanged. Revision History panel lists each reason.
8. Generate the ITP PDF (and Word export) → revision + timestamp correct, branding of E2E Client Org.

## 5. Field execution (Roles B, D, E, F)
1. As A "Notify" parties on each intervention (or let the notify flow fire). Confirm recipients get notifications (bell) and the external dashboards list "pending sign-offs".
2. **Hold (H):** as E try to proceed before the H is released → expect block (if "enforce hold blocks start" is on). As B release the hold → status signed off with name/date.
3. **Witness (W)/Review (R)/Surveillance (S):** sign off as D, C, F respectively; sign off for another party's cell → expect refusal.
4. Overdue test: leave one H notified past its notice period → it must appear in Overdue hold points on the admin dashboard and the ITP's approval roadmap ("Blocking work right now").
5. Run each **checklist** inspection (B): mix pass / fail / partial results, add measurements, photos, signatures; finish → inspection record numbers; issue **IRNs** for the passes.
6. Third-party record (F): upload a test report against an "expected record" activity.
7. Register entries (Registers): add 2 calibration certificates (one expired), 2 welder qualifications, 3 materials (one not released).
8. Standalone assignment: create one, record measurements/witness signature, conclude **Conditional pass** → punch item created → close it → issue clearance.

## 6. NCR, observation, punch list
1. Observation (C or B): raise an observation with photo; track aging/overdue.
2. Fail an inspection → **NCR** auto/linked; as A assign to E; E submits corrective action; A fills root cause/corrective/verification → **close** (CAPA gate). Check cascades: linked punch item closes, inspector notified.
3. Raise a second NCR and leave it **open** (for the "not ready" check).
4. Punch list: add items (single and walkdown); E resolves with closing evidence; verifier closes one; leave one open.

## 7. Vault documents (A, D)
- Upload a drawing with approvers set (multi-approver); approve as each approver; upload a revised file with the same reference → new revision, old superseded; link a governing drawing to an activity.

## 8. Reports and KPIs
- Project → Reports: generate inspection report PDFs, NCR PDF + closeout certificate.
- Project → KPIs: tiles drill into real records; first-time-pass and NCR counts match what you did.
- Admin dashboard: counts (open NCRs, overdue holds, awaiting approval) match.

## 9. Data Book (A) — the main test
Run **three times**, regenerating the PDF each time:
1. **Draft (stage 1, deliberately incomplete):** create Data Book `DB-E2E-001` before closing the open NCR/punch item/expired calibration. Readiness panel must show NOT READY with each blocker. Generate PDF → expect DRAFT watermark, "DRAFT — NOT ISSUED" footer, Missing/In review rows in the master register, open NCR and open punch items listed, unsigned certification.
2. **For review (compile):** close what you can, compile with the conditional-handover override reason for the remainder → PDF says FOR REVIEW; conditional handover reason printed.
3. **Final:** close all NCRs/punch items, renew calibration, release materials, all inspection records have IRNs → readiness 100% → compile → issue handover → PDF says FINAL, no watermark, status "Issued", names on approval table.
4. For each PDF verify against the reference order: Cover → Document control & authorization → Revision/distribution/status → Contents → Scope → Master register → per-ITP records → Materials → Welding → Calibration → NCRs → Punch → Readiness → Final completeness certification → Final acceptance. Check people/dates match the roadmaps, the row counts match the register, branding colour/logo correct.
5. Repeat the final PDF with **white-label** then **JAGS-led** branding (Settings → Branding).
6. Negative checks: re-open an NCR after issue → readiness drops; expired calibration blocks Ready.

## 10. Access and security spot-checks (each party login)
- C/D/E/F see only this project; cannot open org settings, other orgs' projects, or the admin dashboard.
- A subcontractor cannot approve/accept an ITP or sign another party's cell.
- Direct URL to another org's ITP/NCR/data book → not found / forbidden.

## 11. Cleanup
- Delete the E2E project and org (or mark inactive) once results are recorded.

## Results checklist
| Step | Result | Notes |
|------|--------|-------|
| 2 Org + branding | | |
| 3 Project + party logins | | |
| 4 ITP lifecycle + revisions | | |
| 5 Field execution (H/W/R/S) | | |
| 6 NCR / observation / punch | | |
| 7 Vault | | |
| 8 Reports / KPIs | | |
| 9 Data Book draft / review / final | | |
| 10 Access checks | | |
