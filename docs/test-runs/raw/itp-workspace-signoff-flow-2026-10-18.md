# ITP workspace: sign-off and notify flows on dev (build 5ed865e), 18 Oct 2026

ITP MER-2026-001-JAGS-ITP-001, activity 2.5 (Surveillance for GFL and Voltway), logins admin / subcontractor@voltway.demo / contractor@gfl.demo. Driven with Playwright against https://jags-qmp-client-dev.vercel.app.

| Step | Result | Evidence |
|---|---|---|
| Admin presses Notify on Voltway | PASS | Pending -> Notified; the other party's cell stayed Pending |
| Notification reaches the party | PASS | Voltway's notification list 5 -> 6 |
| Double-click on Notify | PASS | one notification (+1), single state change |
| Subcontractor sees only its own action | PASS | Voltway row: Sign off. GFL row (still pending): "Awaiting party", no button. 1 Sign off button in the activity |
| Subcontractor signs off | PASS | row shows Signed off at once; after a reload an admin and the subcontractor both see Signed off; the party's action becomes "Request correction" (no Withdraw for the party) |
| Admin Withdraw | PASS | inline reason + Confirm/Cancel; row returns to Pending (Notify needed again) |
| Hold activity (3.1) | PASS | "Hold open" badge, Hold cells: signed ones show Withdraw, pending shows Notify, no Proceed button anywhere |
| Witness cell pending, not notified (2.4) | PASS | no Proceed button |

Not tested: withdrawing with an empty reason, Proceed after a Witness notice elapses, releasing a Hold as contractor/TPI and the checklist then allowing Start inspection, sign off on behalf, Request correction, "Notify all pending", touch interaction on a phone.

Findings
- The ITP page failed to load twice in a row for the admin ("Something went wrong") after 20 and 29 seconds, then loaded: the page is still slow and sometimes times out on dev.
- A reload within ~4 s of clicking Sign off on a slow response showed the old state in one run; the action had not finished. Later runs persisted. Wait for the response before navigating.
- GFL's sign-off on activity 2.5 changed from Pending to Signed off during the session without a step of mine; another user or agent is working on the shared dev data.

Data left: activity 2.5 Voltway is back to Pending (signed off, then withdrawn with the reason "R2 test: restoring demo data after sign-off flow test"). Withdrawals and notifications are in the audit log and the party's notifications.

## Second pass: the cases left untested (same day, build 5ed865e)

| Case | Result | Evidence |
|---|---|---|
| Hold point: notify, then sign off as staff | PASS | Notify shows "48h 0m left"; Sign off opens "Sign off this hold point? This releases the hold and is recorded with your name and the time. If you sign by mistake, use Request correction." Confirming persisted: the Hold cell reads Signed off (after reload) |
| Staff sign-off on behalf of another party | PASS | Primary "Sign off" on Voltway's notified cell first asks the server, which answers that a reason is needed; the prompt "Sign off on behalf of this party ... Reason (at least 10 characters)" then appears (a few seconds later on dev). With a reason it persisted: Signed off after reload |
| Request correction (party) | PASS | button only on the party's own signed cell; reason field; Confirm disabled when empty and with 5 characters (min 10); with a reason the request posts (200). The sign-off itself stays Signed off by design (it asks staff to act; it does not withdraw) |
| Withdraw (staff) needs a reason | PASS | Confirm disabled with an empty reason; with a reason the cell returns to Pending |
| Phone (Pixel 7 emulation, touch) | PASS | no horizontal scroll collapsed or expanded; activity row 68 px high; every button in an expanded activity is at least 44 px high (Notify, menu, Checklist, Expected records) |
| Witness "Proceed" after the notice period elapses | NOT TESTED | needs 24 h (default) of real time; no Proceed button exists before that (checked) |
| Hold released -> checklist "Start inspection" | NOT TESTABLE on this data | the Hold activities (3.1, 3.3, 3.8) use document/measurement evidence and have no checklist; only checklist-type activities (1.1-2.5, 3.6, 3.9, 4.1) have one and none has a Hold |
| "Notify all pending" | NOT RUN on purpose | would notify about 40 pending points to parties on shared data |

Minor: the on-behalf prompt's Sign off button is enabled with an empty reason (the server still refuses < 10 characters). A page reload before the server action's response arrives discards the click; wait for it (dev answers in a few seconds).
Data: Voltway on 2.5 ends Pending (signed on behalf, then withdrawn with reasons). The 3.1 JAGS Hold is left Signed off.
