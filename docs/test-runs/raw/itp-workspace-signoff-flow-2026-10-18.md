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
