# Data subject requests: export and deletion

_Process for owner approval, updated 2026-10-08. It describes what the system does today and where a person has to decide.
Nothing here is legal advice. Timelines depend on the law that applies to your customers; placeholders mark what only the owner
can set._

## Owner and contact

| Item | Value |
|---|---|
| Process owner | [OWNER TO FILL: name and role, for example data protection contact] |
| Deputy | [OWNER TO FILL] |
| Where requests arrive | [OWNER TO FILL: privacy mailbox]; also the support address (`NEXT_PUBLIC_SUPPORT_EMAIL`) and customer administrators |
| Who executes in the system | A JAGS Admin, using **Settings > Access & Roles > Data Requests** (`/inspect/organisation/data-requests`). Admin only |
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

## The Data Requests screen

A JAGS Admin opens **Settings > Data Requests**, types (part of) the person's email and clicks **Look up**. For each matching account the
screen offers two actions: **Download data export (JSON)** and **Anonymise account**. Inspectors, client users and every other role
cannot see the screen, and the export link and the anonymise action both refuse anyone who is not a JAGS Admin (the check is made on the
server, not only in the page). Both actions are written to the audit log (platform-wide events, visible to JAGS staff).

## Export (access) request

### How
Click **Download data export (JSON)** next to the verified account. The server streams one file named
`data-export-<user id>-<date>.json`. The export is recorded in the audit log (action `data_exported`) before any data is sent; that
record names the account by id only, not by name or email. The export is rate limited like other exports.

### What the file contains
Everything the system holds that points at the account (`user id`), one section each:

| Section | Source | Notes |
|---|---|---|
| `profile` | `users` | Name, email, staff role, active flag, terms acceptance (when recorded), created/updated times |
| `access_grants`, `custom_role_assignments` | access tables | Who they can reach and with what role |
| `team_memberships`, `client_team_memberships`, `party_memberships` | team and project party tables | |
| `audit_events_performed` | `audit_log` (actor) | Events the person performed, including the free-text summary and details |
| `notifications_received`, `email_deliveries` | `notifications`, `email_outbox` | Notification text; for email only the delivery status (not the message body) |
| `inspections_signed`, `inspections_performed` | `inspection_records` | Record number, result, signed-by name and time. **Signature images are not included** |
| `inspection_photos`, `ncr_photos`, `standalone_assignment_photos`, `vault_documents_uploaded` | photo and vault tables | Metadata and storage path only, not the files |
| `comments` | `inspection_comments` | Comments they wrote |
| `document_transmittals_sent` | `document_transmittals` | What they sent and when. Recipient addresses are other people's data and are **not** included |
| `ai_usage` | `ai_usage_log` | Feature, model, token counts, decision. Prompt and response text are **not** included |

The file also lists `row_counts`, the `notes` that explain its limits, and `complete` (true when every section could be read). A section
that fails to read is named under `unavailable_sections` and `complete` is `false`: an export is never silently short. Re-run it, and if
it persists, ask the Supabase project owner to read the missing section by SQL.

When `SUPABASE_SERVICE_ROLE_KEY` is configured the export reads with the service role (some tables, such as notifications and the email
queue, are not readable by another user's session); the file says which was used in `read_with`. Without it the export runs as the
admin's own session and the notifications and email sections may come back empty.

### What is not in the file (handle by hand if the request covers it)
- The actual photos and documents in storage (the file lists their paths; use `scripts/export-storage.mjs`, runbook section 8, for the
  files if the requester is entitled to them).
- Names typed as free text inside records someone else created (captions, party member names, report snapshots, signature images).
- The Supabase Auth record (email, last sign-in). Read it in the Supabase dashboard if needed.
- `auth_attempts`: only one-way hashes, cannot be linked back to a person, outside the export.

### Before you send it
Read it. Other people's names can appear inside the person's own audit summaries and comments; redact where the law requires. Send it by
a secure channel: [OWNER TO FILL: approved secure delivery channel]. The file contains personal data: do not email it in the clear and do
not leave copies on shared drives.

## Deletion / anonymisation request

### What is kept and why
The product is built so records are not hard-deleted: voided IRNs, superseded vault documents, signed inspections and the audit trail
are intentional history, and many are controlled quality (ISO) records that customers and auditors rely on. Rows also refer to the
user (for example `audit_log.actor_id`, `inspection_records` sign-off fields), and the database does not allow removing a user those
rows still point to. So a deletion request is answered by **anonymising** the account: the person can no longer be identified from the
account, and nothing the account touched is deleted.

| Part | Outcome |
|---|---|
| **Account** | Anonymised and deactivated in one step (below). Done at once |
| **Quality / ISO records, audit trail, signed sign-offs and signatures** | Retained for the period the customer's contract or law requires. [OWNER TO FILL: retention period per record type]. Tell the person this and why |
| **Optional extras** (notifications, email queue rows, AI usage rows, uploaded photos not part of a signed record) | May be removed by SQL or storage deletion approved by the process owner. Nothing in the app does this; it is a manual, reviewed action. [OWNER TO FILL: whether and when these are deleted] |

### What "Anonymise account" does
Run it from the Data Requests screen: **Anonymise account…** opens a confirm dialog that requires a typed reason (at least 10
characters, kept in the audit log; write the request reference and the result of the legal-hold check). The server action calls the
database function `anonymise_user(user_id, reason)` (migration `20261129000100_anonymise_user.sql`), which in one transaction:

1. refuses unless the caller is a JAGS Admin, refuses the caller's own account and the **last active JAGS Admin**;
2. replaces `users.full_name` with `Former user` and `users.email` with `anonymised-<user id>@anonymised.invalid`. The id is random and
   was never derived from the email, so the placeholder cannot be reversed to the address. `public.users` has no phone or address column;
   those two are its only personal fields;
3. sets `users.is_active = false` (every database access check then stops recognising the account);
4. replaces the person's own name or email text on the few tables that copy it into a row keyed to the user or to their email:
   `project_party_members.invited_email`, `project_parties.contact_name` / `contact_email` (where the contact is the person's address),
   `document_transmittals.recipient_email` (where the recipient is the person's address), `inspection_records.signed_by_name` (rows they
   signed) and `handover_certificates.received_by_name` (rows they acknowledged);
5. writes one platform-wide audit event (`anonymised`) with the reason, the fields replaced and the number of rows changed per table. It
   does not record the old name or email.

It never deletes a row, changes a foreign key, edits the audit log or removes access grants. It is idempotent: running it again on an
account that is already anonymised changes nothing and says so. A table whose own protection rule refuses the update is reported in the
audit event (`skipped`) rather than failing the whole request.

After the database step the action also updates the Supabase Auth record when `SUPABASE_SERVICE_ROLE_KEY` is configured: the Auth email
is replaced by the same placeholder and the user is banned from signing in. If that is not configured, or Auth refuses the update, the
screen says so and a Supabase project owner must replace the Auth email and ban the user in the dashboard.

### What it does not change
- The audit log, including summaries that were written earlier and may contain the person's name or email (for example "Account x
  deactivated"). These are intentionally untouched. If the law requires them to be redacted, that is a reviewed manual step by the
  Supabase project owner: [OWNER TO FILL: decision on redacting historic audit summaries].
- Free text typed into records by anyone (comments, captions, descriptions, notifications), signature images, and name fields that
  carry no user id (for example `standalone_assignment_signatures.signatory_name`, walkdown attendees, report snapshots).
- Access grants. Deactivation already makes them inert. If you also want them gone, use **Settings > Staff Access > Offboard or restore
  an account** first (it removes the grants and records them), then anonymise.
- Reversal: there is none. The old name and email are not kept anywhere by the function. Deactivation (without anonymising) remains the
  reversible option.

### Deactivation without anonymising
A JAGS Admin can deactivate an account (single account, or a pasted list of emails in the bulk tool) under Settings > Staff Access.
This sets `users.is_active = false`, bans the Auth user, flags the session so the proxy ends it, and removes every access grant (recorded in
the audit event so access can be restored). The last active admin cannot be deactivated. Reactivation is the reverse action. Use this for
restriction or objection requests, or when the account is wanted back.

### Do not
Delete the Auth user or the `users` row as a shortcut. It either fails (records still refer to it) or, if forced, destroys the link that
makes the quality record attributable.

### Record
In the request log record exactly what was exported, deactivated and anonymised, what was kept and the reason for each retention.

## Restriction and objection
Deactivating the account stops further processing through the app. Records stay for the reasons above.

## Correction request
A JAGS Admin corrects name or email in the account or party-member screens; for a signed record, corrections are made by the normal
amend / re-open (with reason) / new revision process so the history stays intact. The audit trail shows the change.

## Roles, permissions
Only a JAGS Admin can use the Data Requests screen, export a person's data, anonymise or deactivate an account. The Supabase project owner
is needed for any direct database or Auth change the screen reports as not done. Every action is recorded in the audit log and the
request log.

## Testing and known gaps
- The export route and the anonymise action have automated tests (`apps/web/lib/data-requests/__tests__`). The SQL function has a script
  test against stub tables (`supabase/tests/anonymise_user.test.sql`, instructions at its top). Both ran against stubs, not the live
  schema: **run the export and an anonymisation on a restored copy of production first** and check the result before the first real
  request. [OWNER TO FILL: engineering sign-off after that rehearsal]
- Whether Supabase Auth accepts the `anonymised.invalid` placeholder address has not been tested against the live project; the screen
  reports it if it refuses.
- The related-table list in `anonymise_user()` is a fixed set. When a new table starts copying a person's name or email, add it to the
  function's plan (new migration) and to the export sections (`apps/web/lib/data-requests/export.ts`).

## Review
Review this process after the first real request and at least [OWNER TO FILL: review interval].
