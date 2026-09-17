# Subprocessor Disclosure

_Last reviewed: 2026-09-17. This document lists the third-party services ("subprocessors") that
process customer data on behalf of JAGS Assurance's QMP Inspect platform, what each one does, and
what data category it touches. It reflects the system as actually deployed, not an aspirational
architecture._

## Summary table

| Subprocessor | Role | Data it touches |
|---|---|---|
| **Vercel** | Hosting for the Next.js application (`apps/web`) — serves the web app and runs its Server Actions/API routes | All data in transit through the application layer, including session tokens; no customer data is stored at rest on Vercel |
| **Supabase** | Primary data platform — Postgres database, Auth, file Storage, and Realtime | All customer data at rest: project records, inspection/NCR content, uploaded evidence photos and vault documents, user accounts and credentials |
| **Railway** | Hosts the background-jobs worker (`worker/`), a Node service that renders PDFs (ITPs, inspection reports, FAT reports, handover packages, portfolio summaries) using headless Chrome (Puppeteer) | Reads the same customer content from Supabase temporarily to render it into a PDF, then writes the finished PDF back to Supabase Storage; does not retain data after a job completes |
| **Google (Gemini API)** | Optional AI drafting assistant — generates ITP drafts, checklist items, NCR description drafts, root-cause suggestions, and similar first-draft text from project content, only when explicitly enabled | Whatever project content (spec excerpts, field notes, checklist responses) is included in a specific AI-assist request — and only for organisations that meet the conditions below |

## Google (Gemini API) — the one that needs its own section

The app's AI-assist features (ITP drafting, checklist generation, NCR drafting, consistency
checks, root-cause suggestions, report narrative drafting) call Google's Gemini API directly via
HTTPS (`generativelanguage.googleapis.com`) — this is Google's own hosted model API, not a
third-party reseller. This is the only subprocessor that receives customer *content* for a purpose
other than storing or rendering it — Gemini reads project text to generate a draft — so it carries
the tightest control of the four.

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

## Notes on the other three

- **Vercel and Railway** do not persist customer data independently — they process it in-flight
  (serving requests, rendering PDFs) and the durable copy always lives in Supabase.
- **Supabase** is a single project shared across all customer organisations; tenant isolation is
  enforced through Postgres row-level security (RLS) policies scoped by organisation and project
  membership, not by separate databases per customer.
- This list will be updated if a new subprocessor is introduced (e.g. a future email/notification
  provider) or an existing one's role changes materially.
