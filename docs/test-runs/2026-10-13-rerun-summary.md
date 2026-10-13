# Playbook re-run on dev build 2a3bb63, 13 October 2026

Playbook: `QMP_Real_World_Test_Playbook.docx` (A1-M8). Four agents drove dev with Playwright; per-step tables are in `raw/rerun-BC.md`, `rerun-DFG.md`, `rerun-HIJL.md`, `rerun-KM.md`. Sections A and E were passed in the first run and not repeated.

| Section | Result now |
|---|---|
| B1-B7 | PASS (after retries; Generate draft once 502, retry OK, 15 activities) |
| C1-C3 | PASS |
| D4, D8 | PASS |
| F1 | not re-run (passed first run). F2 PASS (IRN-2 issued; PDF 200; void min 15 chars). F3 PASS for one eligible row (multi-row and "fails skipped" not exercised). F4 PARTIAL (stale warning not seen). F5 PARTIAL (complete-again refused: evidence check, now fixed in code) |
| G1 PASS. G2 BLOCKED (no under-review ITP of ours) | |
| H2, H3 | PASS (minor findings below) |
| I4 | BLOCKED: no checklist item matches the soft-stop rule (`lib/registers/verify.ts:473-498`: needs register=personnel or weld/NDT/electric in spec text). Data gap |
| J3 PASS (clean compile steps 177-178 not run). J4 PASS. J5 not retested | |
| K1-K6 PASS per app definitions; K7 differs from playbook definitions (see report 13 Oct cross-check) | |
| L1 PASS except live updates FAIL. L2 partial. L3 PASS (Sign-offs and holds filter flaky). L4 PASS | |
| M1-M8 PASS at button level except: M4 external roles can raise NCRs, M5 Inspector can open /inspect/settings, M6 "Your organisations" is admin-only, M7 Reassign confirmed but cancelled, M8 idle sign-out and offline queue untested | |

Root cause of most flaky results: database statement timeouts (about 240 in 3 h, code 57014), amplified by 4 parallel test agents. The app turned failed reads into "Page not found", empty grids and "ITP not found".

## Fixed in this branch (commit a37da49 and following)
ITP page, Return/Submit actions, completion evidence check and NCR assignee list (failed reads reported as errors); signature pad fast-stroke loss.

## Not fixed
- DB timeouts: 157 overlapping policies (multiple_permissive_policies), 42 unindexed foreign keys, 7 auth_rls_initplan, 102 unused indexes (Supabase advisors).
- Live bell updates (realtime subscription in `notifications-bell.tsx`) not delivering on dev.
- Download selected for only non-approved documents returns raw JSON 403/500 instead of an in-app message.
- New drop-pin appears only after reload; Drawings footer count wrong after pin.
- Level change on an approved ITP failed once ("Could not record revision history"); likely the same timeouts, unconfirmed.
- "Unknown offline queue item kind" banner after an answer.
- Activity "Sign-offs and holds" filter sometimes empty (likely swallowed query error).
- Photo upload on checklist crashed the page once.
- Product decisions: external roles raising NCRs (M4); Inspector access to /inspect/settings (M5); client monthly packs; punch close role.
- Playbook wording to correct: checklists are generated on approval (B3); button is "Proceed" with a reason (C3); "Approve review step N" (B7); Void IRN and Re-open have no confirm dialog; Handover verify sentence is on the portal card, not the PDF; Inspector dashboard has no "NCRs assigned to me" or "New inspection"; Your organisations is admin-only.

## Not touched at all
Production site; J5 project close; B7 "reviewer must differ" and UNCONTROLLED COPY; B5 reviewer notification; D4 steps after the waiver (client sign-off, audit entry); F3 multi-row; G2; I4 soft-stop; J3 clean final compile; L2 inbox delivery; M8 idle timeout and offline sync; M7 Reassign effect; M4 server-side enforcement for external NCR raising; the unfixed items above; test-data cleanup.

## Test data left on the shared database
THP-2026-001 (ITP THP-2026-001-JAGS-ITP-001, Data Books DB-RR-J02/J03, handover certificates HC-RR-J02/J03, two client pins, in-progress Voltway inspection on CHK-5), THP-2026-0011, Test Harbour Power org, `thp.vendor@example.test`; MER-2026-001 INSP-1 IRN-6, INSP-2 in progress with IRN-2..5 voided.
