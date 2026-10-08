# Privacy notice (QMP Inspect)

_Draft for owner and legal review. Last updated 2026-10-08. The same text is shown to everyone, signed in or not, at `/privacy`
in the app (`apps/web/app/privacy/page.tsx`, data in `apps/web/lib/legal/privacy-data.ts`). Edit the three together. Nothing
here is legal advice; every `[OWNER TO FILL: ...]` must be completed by the owner before this is relied on._

## Who we are

QMP Inspect is operated by [OWNER TO FILL: legal entity name and registered address]. Questions and requests about personal data go to
[OWNER TO FILL: data protection contact name and role], [OWNER TO FILL: privacy email address] (the in-app page shows the address set in
`NEXT_PUBLIC_SUPPORT_EMAIL` until a privacy address is set).

## What personal data the system keeps, why, and for how long

Derived from the database schema (`supabase/migrations/`) and the code that writes it. Where the system does not delete data
automatically, the table says so rather than inventing a period.

| Data | What it includes | Why | How long |
|---|---|---|---|
| **Account and profile** (`users`, Supabase Auth) | Name, work email, role, active flag, first-login password-change flag; once recorded, when you accepted the terms and which version. Passwords are held by Supabase Auth, not in our tables | Create your account, sign you in, decide what you can see and do | While the account exists. Deactivation stops sign-in and removes grants but keeps the record, because inspection records and the audit trail refer to it. [OWNER TO FILL: retention period] |
| **Access grants** (`access_grants`) | Which organisations and projects you can access and your role there | Enforce who sees which project data (row-level security) | Removed on deactivation; the removed grants are recorded in the audit trail so they can be restored |
| **Audit log** (`audit_log`) | Actor, action, short summary, sometimes before/after details, time. Examples: sign-offs, approvals, NCR changes, account deactivation, terms acceptance | Quality-system and ISO traceability; investigating errors and incidents | Not deleted by the system; audit entries are intentional history. [OWNER TO FILL: retention period] |
| **Inspection sign-offs and signatures** | Your name against each sign-off, time, optional comment, and where you draw one a hand-drawn signature image (inspections, standalone assignments, handover acknowledgements) | Record who inspected, witnessed, approved or acknowledged work | Part of the controlled quality record; not deleted by the system. [OWNER TO FILL: retention period] |
| **Photos and location** (`inspection_photos`, `ncr_photos`, punch photos, `inspection_records.location*`) | Photos you upload with caption and uploader; coordinates, accuracy and distance from the site recorded when an inspection starts. Photo files are stored as uploaded and may carry the camera's own embedded metadata (including GPS) unless the device removed it | Evidence for inspections and non-conformances; a soft check that work was recorded on site | Stored with the inspection record. A daily worker sweep only flags unreferenced photos for an administrator; nothing is deleted automatically. [OWNER TO FILL: retention period] |
| **Notifications** (`notifications`) | Title, text, link, read state, addressed to you | Tell you about work assigned to or waiting on you | Not deleted by the system. [OWNER TO FILL: retention period] |
| **Email delivery queue** (`email_outbox`, `document_transmittals`) | Recipient address (your account, or the address a document was sent to), status, attempts, error text; a send log of who sent which document to which address | Reliable delivery and proof a document was sent | Not deleted by the system. [OWNER TO FILL: retention period] |
| **AI usage log** (`ai_usage_log`) | User, organisation, which AI feature, time. The text sent to the AI provider is not stored in this log | Usage and cost monitoring, rate limiting | Not deleted by the system. [OWNER TO FILL: retention period] |
| **Sign-in throttling** (`auth_attempts`) | One-way hashes of the email and IP address of recent failed sign-in and password-reset attempts, with time | Slow down password guessing | Only the last 15 to 60 minutes count; older rows are not deleted automatically. [OWNER TO FILL: retention period] |
| **Error reports** (Sentry, only if enabled) | Technical error details with names, emails, tokens, bodies and cookies removed | Find and fix faults | Held by the provider under its retention settings. [OWNER TO FILL: retention period] |

**Document retention rules.** An organisation administrator can set a retention period in years (1 to 100) under Settings. A daily
worker sweep then flags vault documents older than that period (counted from approval, or upload if never approved) for an
administrator to review. A review records "keep" or "disposal approved" with a note. The system never deletes or changes the
document itself; disposal, if approved, is carried out outside the application and the flag is the record. This applies to vault
documents only, not to the personal-data rows above.

**Cookies.** Only those needed to keep you signed in, enforce session limits (a signed "last seen" and "profile check" cookie) and remember your
language. No advertising or analytics cookies.

## Who else handles the data (subprocessors)

Supabase (database, sign-in, file storage), Vercel (web hosting), Railway (background worker for PDFs and scheduled checks), Resend
(email delivery, only when configured), Google Gemini API (optional AI drafting, only for organisations that opted in and only on the paid
tier), Sentry (error tracking, only when configured). Purposes and data categories are in `docs/SUBPROCESSORS.md`. We do not sell
personal data. Hosting regions and transfer mechanism: [OWNER TO FILL: regions and transfer mechanism].

## Legal basis

[OWNER TO FILL: legal basis for each purpose, for example contract, legitimate interest, legal obligation]

## Your rights

- Ask what personal data we hold about you and receive a copy.
- Ask us to correct data that is wrong.
- Ask us to delete or anonymise your data. Quality and ISO records and the audit trail may have to be kept; in that case the account is
  deactivated, the record is kept, and we tell you why.
- Object to or ask us to restrict some uses.
- Complain to your data protection authority.

How requests are handled, by whom and how fast: `docs/DATA_SUBJECT_REQUESTS.md`. We aim to respond within
[OWNER TO FILL: response time, for example 30 days].

## Changes

The notice is updated in this repository; the date at the top changes with it. The terms of use (`/terms`) carry their own version.
