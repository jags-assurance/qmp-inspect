# Subprocessor Disclosure

_Last reviewed: 2026-10-08. This document lists the third-party services ("subprocessors") that
process customer data on behalf of JAGS Assurance's QMP Inspect platform, what each one does, and
what data category it touches. It reflects the system as actually deployed, not an aspirational
architecture._

## Summary table

| Subprocessor | Role | Data it touches |
|---|---|---|
| **Vercel** | Hosting for the Next.js application (`apps/web`) — serves the web app and runs its Server Actions/API routes | All data in transit through the application layer, including session tokens; no customer data is stored at rest on Vercel |
| **Supabase** | Primary data platform — Postgres database, Auth, file Storage, and Realtime | All customer data at rest: project records, inspection/NCR content, uploaded evidence photos and vault documents, user accounts and credentials |
| **Railway** | Hosts the background-jobs worker (`worker/`), a Node service that renders PDFs (ITPs, inspection reports, FAT reports, handover packages, portfolio summaries) using headless Chrome (Puppeteer) | Reads the same customer content from Supabase temporarily to render it into a PDF, then writes the finished PDF back to Supabase Storage; does not retain data after a job completes |
| **Resend** | Transactional email delivery: in-app notification emails and emailed document links (transmittals). Used only when `RESEND_API_KEY` is set; both the web app (`apps/web/lib/notifications/email.ts`) and the worker (`worker/src/emailOutbox.ts`) call Resend's HTTPS API (`api.resend.com`) | The recipient's email address, the notification or transmittal title and text (which can include project, record and party names and a link into the app) and the sender address. Document files are not attached: the email carries a link into the app, and opening it needs a signed-in account with access |
| **Sentry** | Error tracking for the web app and the worker. Inactive until `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` is set | Technical error data only. Every event is scrubbed first (`scrubEvent`): user, cookies, headers, request bodies, breadcrumbs and stack-frame variables are removed and emails, tokens and verification links are masked. `sendDefaultPii` is off |
| **Google (Gemini API)** | Optional AI drafting assistant — generates ITP drafts, checklist items, NCR description drafts, root-cause suggestions, and similar first-draft text from project content, only when explicitly enabled | Whatever project content (spec excerpts, field notes, checklist responses) is included in a specific AI-assist request — and only for organisations that meet the conditions below |

## Google (Gemini API) — the one that needs its own section

The app's AI-assist features (ITP drafting, checklist generation, NCR drafting, consistency
checks, root-cause suggestions, report narrative drafting) call Google's Gemini API directly via
HTTPS (`generativelanguage.googleapis.com`) — this is Google's own hosted model API, not a
third-party reseller. This is the only subprocessor that receives customer *content* for a purpose
other than storing or rendering it — Gemini reads project text to generate a draft — so it carries
the tightest control of the list.

**The control, in plain terms:** the application will not send any organisation's real project
data to Google under two independent conditions, and both must be satisfied at once:

1. **Deployment tier.** The production environment must be explicitly configured onto Google's
   paid API tier. If the deployment is on the free tier — which is Google's default and what this
   project runs in development — the application refuses every AI-assist request outright,
   regardless of any other setting, because Google's free-tier terms permit using submitted content
   to improve their models, which is not acceptable for real customer data.
2. **Per-organisation consent.** Separately, each customer organisation carries a stored consent
   flag on its own account record. Even on the paid tier, an organisation that has not explicitly
   opted in will have every AI-assist request refused for that organisation specifically. Consent
   is granted by a JAGS administrator, per organisation — it is never on by default.

Both checks happen in one place in the code, immediately before any AI request is built, so no
draft-generation feature can accidentally bypass them. A request that fails either check returns a
plain "AI assistance is not available yet" message to the user rather than silently proceeding.

There is also a request-volume cap per organisation (a rolling one-minute window) to guard against
runaway or abusive use, unrelated to the privacy control above.

**What is sent, concretely:** when both conditions are met, a single request/response, containing
only the specific project text relevant to that draft (e.g. a spec excerpt and a scope note for an
ITP draft, or field notes for an NCR draft) is sent to Gemini and a text/JSON draft is returned.
Gemini is not given standing access to the database, storage, or any data beyond what a specific
request assembles.

## Notes on the others

- **Vercel and Railway** do not persist customer data independently — they process it in-flight
  (serving requests, rendering PDFs) and the durable copy always lives in Supabase.
- **Supabase** is a single project shared across all customer organisations; tenant isolation is
  enforced through Postgres row-level security (RLS) policies scoped by organisation and project
  membership, not by separate databases per customer.
- **Resend and Sentry** are optional and off until their keys are configured. With no `RESEND_API_KEY`
  nothing is sent to Resend and notifications stay in-app only; with no DSN nothing is sent to Sentry.
  Confirm in the production environment which are switched on: [OWNER TO FILL: production status of Resend and Sentry].
- **Other services named in the repository but not in use.** These are not subprocessors today and
  become ones only if credentials are set and the connector is built against the real service:
  Aconex, Procore, ProjectWise and Microsoft Graph (SharePoint/OneDrive) cloud-folder-sync connectors
  (`lib/connectors/`, `lib/cloud-sync/`; each reports "not configured" until its variables are set), and
  an inbound-email provider for email-to-vault (`/api/vault/email-inbound` is written around Postmark's
  inbound webhook format, but no provider account is connected and no Postmark code or key is used;
  the webhook only accepts calls carrying the shared secret). Before enabling any of them, add it to the
  table above first.
- **Fonts** (Inter, IBM Plex Mono) come through `next/font/google`, which downloads them at build time
  and serves them from the app's own domain; browsers do not contact Google Fonts at runtime.
- **Dependencies at build or run time** (npm packages, Chromium/Puppeteer) run inside the services above and
  receive no customer data.
- This list will be updated if a new subprocessor is introduced or an existing one's role changes
  materially. Review it at least [OWNER TO FILL: review interval] and whenever an environment variable
  for a new third-party service is added.
- Contracts, data-processing agreements, hosting regions and transfer mechanisms for each subprocessor
  are not recorded in this repository: [OWNER TO FILL: DPA status, region and transfer mechanism per subprocessor].
