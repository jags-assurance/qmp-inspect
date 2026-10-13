# Playbook cross-check, 13 October 2026

Method: every row in `docs/test-runs/raw/*.md` and the run report was checked against the code on `dev` (`57ad936` plus the report commits), the reference docs in `docs/`, and (for F2) the live database through rolled-back calls.
Limits: the Real-World Test Playbook itself is not in the repo, so "playbook says" claims were checked only against the four older guides. UI outcomes, counts and timings on dev could not be re-observed from here.

## Verified (claim matches code)
- Fixes present in code: B1 vault revision letters (`lib/vault/revision.ts`), PDF extraction (`next.config.ts`), the "use server" export crash (`38edf0d` + source-scan test), D1/D3 Start work hold rule, checklist fail-loudly and fewer round trips, observation register error + "Raise Observation" label, Reports Reset/Download, On-hold confirm, auth session fixes (`67a134e`), material "A - Approved" fix (`368f0c8`), Inspections list fix (`1800d97`).
- Behaviour claims confirmed in code: NCR raiser cannot close; punch items closed only by Admin or `close_punch_item`; client cannot see monthly packs (SELECT policy requires staff); Inspector can open `/inspect/settings`; Data Book override is Admin-only; lockout is 5 per email / 30 per IP / 15 min; idle timeout 12 h.
- F2 on the exact failing case: with the migration applied, `issue_irn` for MER-JAGS-ITP-001-INSP-2 returns `MER-JAGS-ITP-001-IRN-2` (rolled back, nothing written). INSP-1 already holds IRN-1; INSP-3 is refused for an open Hold (intended).

## Report statements that are wrong or overstated (fix the report)
1. Section 1 "F1, F4, F5 pass": F5 is PARTIAL (change-answer and complete-again not run).
2. Section 1 H "Pass": omits the H2 bug below. K "Pass": omits K BUG-3, the client "Your projects" gap, the Accept-button gap and the K5 definition difference. G "Pass": two flaky errors, closed-project message untested.
3. Section 1 D4 "blocked by bug 2": there is a second cause. The waive-notice form shows only while a Witness row is still pending (before Notify) and all items are answered with evidence.
4. Section 2 "F2 cause unconfirmed" and section 4 "transmittals to fake addresses still fail" are stale: the migration is applied and tested, and `ddf3a31` now refuses fake addresses.
5. Header "None deployed to dev" is stale (dev rebuilt at `57ad936`).
6. Raw J1 cites policy lines 36-37 (INSERT policy); the SELECT clause is lines 76-81 of `20260927010000_ncr_closeout_certificate_pdf_job.sql`. Raw J2 line 288 is 289. Raw F3 blames a select error; the real cause was `1800d97`. F4 "stale warning checked under F5" has no support.
7. L1 (bell click) is "probably fixed", not confirmed on the deployed build.

## Bugs found by the cross-check, not fixed
| # | Where | Issue |
|---|---|---|
| 1 | `components/domain/transmittal-section.tsx` / `vault-document-view.tsx:384` | Transmittal section is hidden unless approved, so the "Only an approved document can be emailed" message is dead code. |
| 2 | `app/inspect/projects/page.tsx:96-100` | "Open NCRs" count includes observations; dashboards exclude them. |
| 3 | `app/inspect/projects/...` / client dashboard | A client not party-linked does not see their project, and the dashboard offers ITPs the client cannot accept (`itp-detail-view.tsx:609`). |
| 4 | `itp-detail-view.tsx` (~245) | Sign-off grid section query error is not surfaced (M2-M4 grid did not render). |
| 5 | `add-material-form.tsx:78` | Form default is "A - Approved" although non-staff are forced to "C". |
| 6 | `data-book-view.tsx:513` | Copy says "Staff may compile anyway"; only Admin can. |
| 7 | `kpis-view.tsx:332` | Readiness described as "a proxy" but the card uses real readiness. |
| 8 | `lib/databook/readiness.ts:86` | A project with no ITPs shows the empty gates as green. |
| 9 | IRN UI (`actions.ts:1700-1706`) | An open Hold on IRN issue shows the generic "Could not issue" text on some paths. |
| 10 | Test data | THP-2026-001 was put on hold and back on the shared database; THP-2026-0011 also exists. |

## Doc wording that disagrees with the app
- D4: all four guides describe Witness -> Notify -> Sign off only; none mention the waive-notice form.
- Punch close: playbook says Inspector; app and `E2E_TEST_PROCEDURE.md` say Admin / `close_punch_item`.
- `CLIENT_PERSPECTIVE_TESTING_GUIDE.md:397,402`: says clients see monthly packs; they do not.
- `MANUAL_TESTING_GUIDE.md`: NCR numbers omit `-JAGS-` (:162); card is "Pending inspections" but the app says "Inspections in progress"; Data Book override called "staff-only" (Admin only); Inspector "Your organisations" panel (:§16.4) is admin-only; Inspector settings access (§15) disagrees with the app.
- `COMPLETE_PROJECT_LIFECYCLE_GUIDE.md` ~185-200: activity feed is described as events; it is current state only.
- KPI definitions (`lib/kpis/compute.ts:304-349, 528, 537, 545-546`) differ from the playbook table: inspections completed counts records, ITP completion is client-accepted / all ITPs, trend buckets by created_at, NCR close-out includes withdrawn.
- Audit log is staff-only; playbook "Admin then Client" is wrong. Client lands on the ITP register, not the dashboard.

## Cases never run
F3 bulk IRN; F5 change answer and complete again; G1 closed-project message, G2; H2 non-approved refusal, H3 client drop-pin; I4 on THP; J3 clean compile, J4 reject / reopen / on-behalf acknowledge; K6 hold and witness cells; L1 live bell; L2 real email; L4 vault search; M1 client IRN / close-NCR / other-org URL; M2-M4 and M7 sign-off grid; M8 five wrong passwords; B and C (blocked at test time, need re-run on the deployed build); D4.
E2E section 7 rows never run: sign another party's cell, forged server action, release material as D/E, edit completed inspection without re-open, re-open with no reason, second live IRN, close punch item as D/E/C, approve vault document without permission, edit/delete approved vault document, edit evidence after sign-off, queue org-wide pack as B.
