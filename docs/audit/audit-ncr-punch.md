# Audit: NCR, observations, punch list, scorecard, automation (read-only, 2026-10-14)

Scope: apps/web/lib/ncrs/*, apps/web/lib/punch-list/*, worker/src/automation.ts, live DB (project qbappyddqdnbwbhbzwei, read-only SQL).
Not tested in a browser; flows traced in code and DB triggers.

## What works (verified in code / DB)
- NCR state machine enforced in the DB, not only the UI: `ncrs_enforce_workflow` (open > in_progress > pending_verification > closed; return-for-rework staff-only; CAPA and evidence required to submit and to close; raiser cannot close; assignee or CAPA author cannot verify, admin override needs a reason; reopen is closer-only; withdraw = close with a reason of 5+ characters). TS mirrors it: apps/web/lib/ncrs/rules.ts, actions.ts:495-700 and 1123-1228.
- Client acceptance gate in the DB (`ncrs_client_acceptance_guard`) and in TS (acceptance.ts, acceptance-actions.ts).
- Punch DB guard `punch_list_items_guard_transition`: resolve needs evidence text; close needs a verifier, notes and a different person from the resolver (non-NCR items); reopen is verifier-only; NCR-sourced items cascade with the NCR. TS actions (punch-list/actions.ts:369-690) enforce photos on resolve and use atomic status filters.
- Withdrawn NCRs close their punch items and are excluded from the scorecard (scorecard.ts:36). Observations are excluded from the Data Book NCR gate (databook/readiness.ts:138) and from the punch list. Open punch items (status <> closed, so "resolved" too) block Data Book compile (readiness.ts:150, 350).
- Worker sweeps ncr_overdue / punch_overdue run: all 15 orgs have enabled rules for all 4 rule types; "NCR due soon", "Overdue NCR" and "Punch item due soon" notifications exist in the live DB; tiered escalation (escalation.ts) and per-step dedupe (reminderPolicy.ts) work.
- Server-side permission checks exist on close, reopen, bulk update, withdraw (mayCloseNcr, hasPermission close_punch_item) and are backed by DB triggers.
- NCR CSV export route is authenticated (ncrs/export/route.ts:22). Punch CSV is a client-side export of already-loaded rows (punch-list-table.tsx:129).

## Findings

### Critical
None found.

### High
H1. Overdue punch reminders go to nobody but are logged as sent. Live: 3 open punch items overdue since 2026-10-09 with created_by NULL and no responsible party each have 3-4 rows in automation_notification_log but 0 notifications. sweepPunchOverdue (worker/src/automation.ts:336-358) adds only the party user, else created_by; at tiers 1-2 the recipient set can be empty, and recordSent() still runs, so every step is burned. Admins are added only at tier 3 (or for resolved items). Fix: fall back to org admins at any tier when empty, and do not recordSent when nothing was delivered. Size S.

H2. Worker `notify()` ignores insert errors (automation.ts:101-110, no error check), then recordSent runs, so a failed insert silently consumes the reminder step. Same pattern in the Hold sweep (168-171) and NCR sweep (268-271). Size S.

H3. Email delivery is effectively off. email_outbox: 573 skipped (test/demo addresses), 1 sent, 1 failed (Resend 403: only the owner's own address allowed, domain not verified). NCR/punch reminders and assignment notices are in-app only until the sending domain is verified. Configuration, not code. Size S (ops).

H4. 8 closed, non-withdrawn NCRs in live data have zero evidence (no photo, no linked document): GSP-PLATFORM-7 001/002/003, E2E-001 001/002, ATL-2026-001-NCR-001, plus the closed withdrawn THP-2026-001-NCR-002 (expected). ATL-...-NCR-001 was also closed without preventive action. These are legacy rows that predate the evidence rule (the DB trigger now blocks new ones), but the close-out certificate and Data Book show no evidence for them. Backfill or flag. Size S.

### Medium
M1. Unowned NCRs. 9 of 15 non-closed NCRs have no assignee and no responsible party (7 open observations, 1 in-progress observation, 1 open minor with no due date). The raise form does not require an owner, and createNcrAction notifies only the assignee and party login (actions.ts ~394-409), so staff/closers are never told an unowned NCR exists. The overdue sweep then targets only the raiser (automation.ts:245-256) until tier 2. Fix: notify project closers/admins when no owner, or require an owner for minor/major. Size S-M.

M2. NCR raise/assign notifies only the party's primary login (partyUserIdOf, actions.ts ~395), not party team members, although partyUserIds exists and is used for work permission (actions.ts:592, 1154). The NCR sweep also uses only project_parties.user_id (automation.ts:251). Members who can act for the party are not told. Size S.

M3. Client acceptance dead ends. (a) Marking acceptance required sends no notification to the client party (acceptance-actions.ts:42-90 has no notify). (b) A client rejection notifies only raiser and assignee, not closers or staff (lines ~160-170). (c) After a rejection the only way to ask again is staff toggling "required" off and on (clears the decision, lines 59-67), also silent. An NCR can sit in pending_verification indefinitely with nobody chasing the client. Not exercised live (0 NCRs with acceptance required). Size M.

M4. Punch items with no responsible party and no creator are unreachable. Live: 12 of 14 open and 3 of 6 resolved punch items have no responsible party; 3 open items have created_by NULL (system/seed created). With no party login only staff or verifiers can resolve them, and reminders have no addressee (see H1). Size S (default a party, or require one at add).

M5. Closed punch data quality. 10 closed non-withdrawn items have no resolver, 6 have no verification notes, 1 was closed by its resolver, and 13 have no closing photos. These are legacy or NCR-cascade closes; the cascade path (v_cascade_close in the guard) skips the resolve step by design. The Data Book counts them as closed with no evidence. Size S (decide policy; backfill).

M6. The punch "resolve needs a photo" rule is TS only (resolvePunchItemAction, punch-list/actions.ts ~395). The DB guard requires only closing_evidence text, so any other writer (offline sync, direct API) can resolve with no photo. Size S (add a DB check).

M7. NCR withdraw notifies only the raiser (actions.ts ~1763). The assignee and responsible party working it are not told it was withdrawn. Size S.

M8. Single-verifier deadlock for punch items: an item resolved by the only admin cannot be closed by that same person (TS closePunchItemAction and DB guard), and punch has no admin override with a reason (NCR does). An org with one verifier gets stuck. Not hit live (4 active staff). Size S-M.

### Low
L1. A tier step is consumed if its only recipient is inactive (onlyActiveUsers, automation.ts:90-99). Covered by the H1 fix.
L2. Worker "verifier" escalation only reads custom roles (getCloseNcrHolderIds / getPunchVerifierUserIds, automation.ts:189-206, 288-305). Built-in admin staff are added only at tier 3 (or when pending verification), so tier 2 reaches nobody for orgs that rely on staff admins rather than custom roles. Size S.
L3. Several notification/audit blocks are best-effort with empty catches (punch-list/actions.ts:99, 189, 212, 333, 441, 554, 652, 772; ncrs notifySafe). Acceptable, but failures are invisible.
L4. The scorecard groups NCRs without a responsible party under one null vendor row and excludes observations (scorecard.ts:36-41), so its totals will not match the NCR register total.
L5. Withdrawn NCRs correctly drop out of the overdue sweep (they are closed); no issue, noted for completeness.

## UNVERIFIED
- No live NCR is in pending_verification and none uses client acceptance. The verifier-sees-evidence UI, close-out certificate PDF and client accept/reject were checked in code only, not on live data or in a browser.
- AI root-cause/description helpers (actions.ts:933-1122): gated by assertAiAllowed and logged; output quality and Gemini availability not tested.
- Walkdown bulk add, punch photo display to the verifier (punch-list-view.tsx uses closing_photo_paths) and the offline-sync punch path were not exercised.
- Worker is assumed deployed and polling; live notifications through 2026-10-13/14 are indirect evidence only.

## Counts
Critical 0, High 4, Medium 8, Low 5.
