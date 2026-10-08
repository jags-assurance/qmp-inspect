# Data subject requests: export and deletion

_Draft process for owner approval, 2026-10-08. It describes what the system can do today and where a person has to decide.
Nothing here is legal advice. Timelines depend on the law that applies to your customers; placeholders mark what only the owner
can set._

## Owner and contact

| Item | Value |
|---|---|
| Process owner | [OWNER TO FILL: name and role, for example data protection contact] |
| Deputy | [OWNER TO FILL] |
| Where requests arrive | [OWNER TO FILL: privacy mailbox]; also the support address (`NEXT_PUBLIC_SUPPORT_EMAIL`) and customer administrators |
| Who executes in the system | A JAGS Admin (admin-only features), with the Supabase project owner for anything done directly in the database |
| Request log | [OWNER TO FILL: where requests are recorded: date received, requester, type, decision, date closed] |

Where the customer organisation is the controller of its inspection data and JAGS the processor, the request is passed to the
customer's administrator and acted on at their instruction: [OWNER TO FILL: controller / processor position per contract].

## Timelines

| Step | Target |
|---|---|
| Acknowledge receipt | [OWNER TO FILL: for example 3 working days] |
| Verify the requester's identity | Before anything is released or changed (see below) |
| Complete or give a reasoned refusal | [OWNER TO FILL: statutory period that applies, for example one month, extendable where the law allows] |

## Steps for every request

1. **Log** the request and the date received.
2. **Verify identity.** Reply to the email address on the account (or the customer administrator's confirmation). Never act on a
   request from an unverified address, and never release data to a third party without the person's written consent.
3. **Classify:** export (access), correction, deletion/anonymisation, restriction or objection.
4. **Check for a legal hold or a quality-record duty** (below) before any deletion.
5. **Carry out** the steps in the relevant section. Record each step in the request log.
6. **Reply** with what was done, what was kept and why, and how to complain. Close the log entry.

## Export (access) request

### What can be exported
Everything linked to the person's account, from these places:

| Data | Where it is held | How an admin gets it today |
|---|---|---|
| Name, email, role, active flag, terms acceptance | `users`, Supabase Auth | Supabase dashboard (Table editor / Auth users) or SQL, by the Supabase project owner |
| Access grants and teams | `access_grants` and team tables | Staff Access and Teams screens (Settings); SQL for a full list |
| What they did (audit trail) | `audit_log` (actor) | Project audit log screen, filtered by person, with CSV or PDF export per project (`/inspect/projects/<id>/audit-log`). Account-level and organisation-level events have no project and need SQL |
| Their sign-offs, signatures, inspections, NCRs, observations, punch items, comments | Project tables | Inspection, NCR and report screens and PDFs; Data Book; Reports and Documents. The traceability lookup finds records by reference |
| Photos and documents they uploaded | Storage buckets `inspection-evidence`, `generated-documents` | Open from the record, or the storage export script (`scripts/export-storage.mjs`, see the runbook section 8) filtered by the paths in the database |
| Notifications and emails sent to them | `notifications`, `email_outbox`, `document_transmittals` | SQL by the Supabase project owner |
| AI usage | `ai_usage_log` | Usage and Cost screen shows organisation totals; per-user rows via SQL |

There is **no self-service "download my data" button** and no single export that gathers all of the above. Today an export is a manual
assembly by a JAGS Admin and the Supabase owner: run the reads listed above, put the results (CSV or PDF) in one folder, review it so it
contains only that person's data (other people's names inside shared records stay in the record; redact where the law requires),
and send it by a secure channel. [OWNER TO FILL: approved secure delivery channel]. A scripted per-user export would be a future
feature; it is not built.

### Sign-in throttling data
`auth_attempts` holds only one-way hashes, so it cannot be linked back to a person and is outside the export.

## Deletion / anonymisation request

### What is kept and why
The product is built so records are not hard-deleted: voided IRNs, superseded vault documents, signed inspections and the audit trail
are intentional history, and many are controlled quality (ISO) records that customers and auditors rely on. Rows also refer to the
user (for example `audit_log.actor_id`, `inspection_records` sign-off fields), and the database does not allow removing a user those
rows still point to. So a deletion request is normally answered in two parts:

| Part | Outcome |
|---|---|
| **Account** | Deactivate it (below): sign-in is banned, open sessions end, access grants are removed. Done at once |
| **Personal identifiers on the account** | Anonymise where the law requires and no quality-record duty prevents it (see "Anonymisation") |
| **Quality / ISO records, audit trail, signed sign-offs and signatures** | Retained for the period the customer's contract or law requires. [OWNER TO FILL: retention period per record type]. Tell the person this and why |
| **Optional extras** (notifications, email queue rows, AI usage rows, uploaded photos not part of a signed record) | May be removed by SQL or storage deletion approved by the process owner. Nothing in the app does this; it is a manual, reviewed action. [OWNER TO FILL: whether and when these are deleted] |

### How an admin does it today with existing features
1. A **JAGS Admin deactivates the account** (single account, or a pasted list of emails in the bulk tool). This sets `users.is_active = false`,
   bans the Auth user, flags the session so the proxy ends it, and removes every access grant. The removed grants are written to the
   audit event so access can be restored if the request was wrong. The last active admin cannot be deactivated. Reactivation is the
   reverse action.
2. If the request also covers the **name and email**, anonymisation is a reviewed manual step by the Supabase project owner,
   after the process owner confirms no legal hold: replace `users.full_name` and `users.email` with a non-identifying placeholder
   (for example "Former user" and a reserved address) and change the Supabase Auth email to match. This is **not a built-in feature
   and has not been tested** against the live schema; do it on a restored copy first, and expect name fields stored as text inside
   some records (for example party member names, signature captions, report snapshots) to remain. [OWNER TO FILL: engineering
   sign-off on the anonymisation script, or a decision that deactivation alone is the product's answer]
3. **Do not delete the Auth user or the `users` row** as a shortcut. It either fails (records still refer to it) or, if forced,
   destroys the link that makes the quality record attributable.
4. Record in the request log exactly what was deactivated, anonymised and kept, with the reason for each retention.

### Restriction and objection
Deactivating the account stops further processing through the app. Records stay for the reasons above.

## Correction request
A JAGS Admin corrects name or email in the account or party-member screens; for a signed record, corrections are made by the normal
amend / re-open (with reason) / new revision process so the history stays intact. The audit trail shows the change.

## Roles, permissions
Only a JAGS Admin can deactivate an account. The Supabase project owner is needed for any direct database or Auth change. Every action is
recorded in the audit log or the request log.

## Review
Review this process after the first real request and at least [OWNER TO FILL: review interval].
