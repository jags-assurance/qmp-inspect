// What personal data the system keeps, derived from the database schema (supabase/migrations) and the
// code that writes it. docs/PRIVACY_NOTICE.md carries the same table: edit both together.
// Retention text never states a period the code does not enforce: where nothing deletes the data
// automatically, it says so and leaves a placeholder for the owner's decision.

export interface PersonalDataRow {
  category: string;
  /** Tables / fields holding it. */
  what: string;
  purpose: string;
  retention: string;
}

export const RETENTION_PLACEHOLDER = "[OWNER TO FILL: retention period]";

export const PERSONAL_DATA: PersonalDataRow[] = [
  {
    category: "Account and profile",
    what: "Name, work email address, role, whether the account is active, first-login password-change flag, and (once recorded) when you accepted the terms of use and which version. Passwords are held by the sign-in provider (Supabase Auth), not in our own tables.",
    purpose: "To create your account, sign you in and decide what you may see and do.",
    retention:
      "Kept while the account exists. Deactivating an account stops sign-in and removes its access grants but keeps the record, because inspection records and the audit trail refer to it. " +
      RETENTION_PLACEHOLDER,
  },
  {
    category: "Access grants",
    what: "Which organisation(s) and project(s) you have access to, and your role there (including who granted it, in the audit trail).",
    purpose: "To enforce who can see which project data (row-level security).",
    retention: "Removed when an account is deactivated; the removed grants are recorded in the audit trail so access can be restored.",
  },
  {
    category: "Audit log",
    what: "Who did what and when: actor, action, a short summary and, for some events, before/after details. Examples: sign-offs, approvals, NCR changes, account deactivation, terms acceptance, retention decisions.",
    purpose: "Quality-system and ISO traceability; investigating errors and security incidents.",
    retention: "Not deleted by the system: audit entries are intentional history. " + RETENTION_PLACEHOLDER,
  },
  {
    category: "Inspection sign-offs and signatures",
    what: "Your name against each sign-off, the time, an optional comment, and, where you draw one, a hand-drawn signature image on inspections, standalone assignments and handover acknowledgements.",
    purpose: "To record who inspected, witnessed, approved or acknowledged work, as the quality record requires.",
    retention: "Part of the controlled quality record; not deleted by the system. Document retention rules only flag old vault documents for human review. " + RETENTION_PLACEHOLDER,
  },
  {
    category: "Photos and location",
    what: "Inspection, NCR and punch photos you upload (with caption and who uploaded them), the coordinates and accuracy recorded when an inspection is started, and how far that was from the project site. Photo files are stored as uploaded: they may carry the camera's own embedded metadata, including GPS, unless your device removed it.",
    purpose: "Evidence for inspections and non-conformances; a soft check that work was recorded at the site.",
    retention: "Stored with the inspection record. A daily sweep flags photos that no record refers to for an administrator to review; nothing is deleted automatically. " + RETENTION_PLACEHOLDER,
  },
  {
    category: "Notifications",
    what: "In-app notifications addressed to you (title, text, link, read state).",
    purpose: "To tell you about work assigned to you or waiting on you.",
    retention: "Not deleted by the system. " + RETENTION_PLACEHOLDER,
  },
  {
    category: "Email delivery queue",
    what: "For each email sent: the recipient (your account, or the address a document was sent to), delivery status, attempts and any error text. A send log of emailed documents records who sent what to which address.",
    purpose: "To deliver notification and document emails reliably and to prove a document was sent.",
    retention: "Not deleted by the system. " + RETENTION_PLACEHOLDER,
  },
  {
    category: "AI usage log",
    what: "Which user and organisation used an AI assistant feature, which feature, and when. The text sent to the AI provider for a request is not stored in this log.",
    purpose: "Usage and cost monitoring and rate limiting.",
    retention: "Not deleted by the system. " + RETENTION_PLACEHOLDER,
  },
  {
    category: "Sign-in throttling",
    what: "A one-way hash of the email address and of the IP address for recent failed sign-in and password-reset attempts, with the time. The raw email and IP are not stored in this table.",
    purpose: "To slow down password guessing.",
    retention: "Only the last 15 to 60 minutes are used; older rows are not deleted automatically. " + RETENTION_PLACEHOLDER,
  },
  {
    category: "Error reports",
    what: "If error tracking is switched on: technical details of an error with names, emails, tokens, request bodies and cookies removed before sending.",
    purpose: "To find and fix faults.",
    retention: "Held by the error-tracking provider under its own retention settings. " + RETENTION_PLACEHOLDER,
  },
];

export const SUBPROCESSOR_SUMMARY: { name: string; purpose: string }[] = [
  { name: "Supabase", purpose: "Database, sign-in, file storage (all records, photos and documents)" },
  { name: "Vercel", purpose: "Hosting of the web application" },
  { name: "Railway", purpose: "Background worker that renders PDFs and runs scheduled checks" },
  { name: "Resend", purpose: "Sending notification and document emails (only when configured)" },
  { name: "Google (Gemini API)", purpose: "Optional AI drafting assistant (only for organisations that opted in, on the paid tier)" },
  { name: "Sentry", purpose: "Error tracking (only when configured; personal data scrubbed before sending)" },
];

export const USER_RIGHTS: string[] = [
  "Ask what personal data we hold about you and get a copy.",
  "Ask us to correct data that is wrong.",
  "Ask us to delete or anonymise your data. Quality and ISO records and the audit trail may have to be kept; in that case your account is deactivated and the record is kept, and we will tell you why.",
  "Object to or ask us to restrict some uses of your data.",
  "Complain to your data protection authority.",
];
