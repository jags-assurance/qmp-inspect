JAGS ASSURANCE
Quality Management Platform
PRODUCTION READINESS
& Platform Standards Guide
What must be true before any real client uses QMP — database, storage, security,
AI in every module, best-in-class reports, and Power BI across the platform
For the QMP development team  ·  Version 1.0  ·  Internal Use Only
# How to Use This Guide
The build guides (QMP Inspect, QMP Resource) intentionally keep things simple so you can build and test quickly — for example, they use a simple file-based database. That is correct for building. But before any real client — internal or external — depends on the platform, a set of production-grade standards must be in place.
This document is that checklist. It also sets three platform-wide standards you asked for: AI in every module, best-in-class reports, and Power BI across the whole platform. Treat it as the definition of 'ready for real use'.
[TABLE]
INFO  Priority key | CRITICAL — must be done before ANY real client data goes in. Non-negotiable. | HIGH — must be done before external (paying) clients go live. | STANDARD — strongly recommended; do as the platform grows.
[/TABLE]
[TABLE]
IMPORTANT  The one rule that matters most | Build and test on the simple setup from the guides. | Do the CRITICAL items on this list BEFORE putting any real person's data in. | Do the HIGH items before external clients rely on it. | Nothing here changes what you build — it changes how it is deployed and secured.
[/TABLE]
# 1. Database — Move from Simple to Production
The build guides use SQLite (a single file). This is perfect for development but not for many users at once or real client data. Before go-live, move to PostgreSQL. The guides are written so this is a straightforward switch, not a rebuild.
[TABLE]
Done | Database readiness | Priority
☐ | Move from SQLite to PostgreSQL (or a managed Postgres like Supabase / AWS RDS) for production | CRITICAL
☐ | Keep SQLite for local development; use Postgres for the live/hosted version | HIGH
☐ | Set up automatic daily backups of the database, stored separately from the server | CRITICAL
☐ | Test restoring from a backup at least once — a backup you have not tested is not a backup | CRITICAL
☐ | Enable encryption of data at rest (managed Postgres providers offer this as a setting) | HIGH
☐ | Use a connection pool so many users can access at once without slowdowns | HIGH
☐ | Keep the read-only reporting views (for Power BI) separate from the live tables | HIGH
[/TABLE]
[TABLE]
TIP  How to do the switch | Ask Claude: 'Switch the database from SQLite to PostgreSQL for production, keeping | SQLite for local development.' It will update the connection and the queries. | Managed options (Supabase, Neon, AWS RDS) handle backups and encryption for you — | recommended so you are not maintaining a database server yourself.
[/TABLE]
# 2. File Storage — Documents, Photos & Evidence
Inspections capture photos, signatures, and uploaded documents (drawings, certificates, test reports). In the build guides these save to the local server. For real use, files must live in proper cloud storage with access control, so they are safe, backed up, and only visible to the right client.
[TABLE]
Done | Storage readiness | Priority
☐ | Move file storage to cloud object storage (AWS S3, Cloudflare R2, or similar) | CRITICAL
☐ | Ensure each client's files are access-controlled — no client can reach another's files | CRITICAL
☐ | Serve files through time-limited secure links, not permanent public URLs | HIGH
☐ | Back up stored files (versioning on the storage bucket is the easy way) | HIGH
☐ | Set a sensible file-size limit and allowed file types on upload | STANDARD
☐ | Scan uploads for malware if clients upload files into the system | STANDARD
[/TABLE]
[TABLE]
INFO  Why this matters for your clients | Oil & Gas and EPC clients will audit where their project documents and inspection | evidence are stored. 'On our server in a folder' will not pass. 'Encrypted, access- | controlled cloud storage with backups' will. This is a trust and sales issue, not | just a technical one.
[/TABLE]
# 3. Security — Protecting Access & Data
The build guides include the essentials: login with encrypted passwords (bcrypt), secure sessions (JWT), roles, and per-client data isolation. That is a good base. Here is what to add before external clients rely on it.
### Already in the build guides (good foundation)
- Login with passwords stored securely (hashed with bcrypt — never in plain text).
- Role-based access (admin, inspector, client, etc. see only what they should).
- Each client's data is isolated from every other client.
### To add before go-live
[TABLE]
Done | Security readiness | Priority
☐ | Force HTTPS everywhere (encrypted connection) — never plain HTTP in production | CRITICAL
☐ | Enforce strong passwords and add a password-reset flow | HIGH
☐ | Add an audit log: record who did what and when (created, edited, signed, viewed) | HIGH
☐ | Add rate limiting / lockout to stop repeated login guessing | HIGH
☐ | Store secrets (API keys, DB passwords) in environment variables, never in the code | CRITICAL
☐ | Add two-factor authentication (2FA) for admin and Jags staff accounts | HIGH
☐ | Offer Single Sign-On (SSO) for large enterprise clients who require it | STANDARD
☐ | Keep software dependencies updated; check for known vulnerabilities regularly | STANDARD
☐ | Have a documented data-privacy position (where data lives, who can see it, retention) | HIGH
[/TABLE]
[TABLE]
BEFORE GO-LIVE  The absolute must-dos before real data | HTTPS on. Secrets out of the code and in environment variables. Backups running and | tested. Client data isolation verified. If these four are not true, do not put any | real person's data in the system yet.
[/TABLE]
# 4. AI in Every Module — Platform Standard
QMP Inspect already has four AI features (Prompt 11). The standard going forward: every QMP module includes AI that assists the user — powered by the Anthropic Claude API. This is a genuine advantage over large competitors, who cannot add this quickly across their legacy systems.
[TABLE]
IMPORTANT  The golden rule for AI in a quality/compliance system | AI ASSISTS — the human always DECIDES and SIGNS. | AI drafts, suggests, and summarises. A qualified person reviews and approves every | time. The AI never signs off an inspection, closes an NCR, or makes a compliance | decision on its own. This keeps the system auditable and defensible. | Also: never send a client's confidential data to AI without their agreement.
[/TABLE]
### The AI pattern for each module
[TABLE]
Module | Useful AI assists (draft — human approves)
QMP Inspect | Draft NCR wording, suggest ITP activities, write inspection narrative, field Q&A helper (already built)
QMP Resource | Summarise a candidate's fit for a role, draft outreach messages, suggest best matches in plain words
QMP Audit | Draft audit findings, suggest audit checklist questions from a standard, summarise audit results
QMP Comply | Explain what a code/standard clause requires, flag likely gaps, summarise compliance status
QMP Improve (CAPA) | Suggest likely root causes, draft corrective/preventive actions, spot repeat issues
QMP ISO | Draft procedure text, map activities to ISO clauses, explain a clause in plain language
QMP PreQual | Summarise a supplier's submission, draft pre-qual scoring notes
QMP Train | Generate quiz/competency questions, summarise training gaps
QMP Surveillance | Draft surveillance visit reports, summarise vendor performance trends
[/TABLE]
[TABLE]
Done | AI readiness (per module) | Priority
☐ | Every module includes AI assist features, using the Anthropic Claude API | HIGH
☐ | AI output is always editable and must be approved by a person before it is used | CRITICAL
☐ | AI features are hidden/disabled cleanly if no API key is configured (no errors) | HIGH
☐ | The API key is stored securely (environment variable), never in the code or UI | CRITICAL
☐ | A short note tells users when they are seeing AI-drafted content | STANDARD
☐ | Client-confidential data is not sent to AI without the client's agreement | HIGH
[/TABLE]
[TABLE]
TIP  How to add AI to a new module | Reuse the pattern from QMP Inspect Prompt 11. Ask Claude Code: | 'Add AI assist features to this module using the Anthropic Claude API, following | the same pattern as QMP Inspect — draft content the user reviews and approves, | hidden if no API key is set.'
[/TABLE]
# 5. Best-in-Class Reports — Platform Standard
Reports are what the client actually sees and keeps. They must look like a professional consultancy produced them — not a spreadsheet dump. This is a standard for every module.
### What 'best-in-class' means here
- Clean, branded PDFs (Burgundy/Gold, Inter font, Jags logo) for anything a client reads or files.
- Excel exports for the underlying data clients want to work with.
- A clear executive summary first, detail after — written in plain, confident language.
- Charts and KPIs shown visually, not as raw numbers.
- Consistent look across every module, so all Jags reports feel like one family.
- Every report carries the traceability header (project, client, date, reference) and A4 print standards.
[TABLE]
Done | Report readiness (per module) | Priority
☐ | Client-facing reports are branded PDFs (Burgundy/Gold, Inter, logo, A4) | HIGH
☐ | Data exports are provided as clean Excel files | HIGH
☐ | Each report opens with a plain-language executive summary | STANDARD
☐ | Charts/KPIs are shown visually, not as bare tables of numbers | STANDARD
☐ | Reports look consistent across all modules (one Jags style) | HIGH
☐ | AI can draft the summary narrative (human edits and approves) | STANDARD
☐ | A monthly client report pack is available (PDF + Excel), like QMP Inspect Prompt 26 | HIGH
[/TABLE]
[TABLE]
INFO  You already have the template | QMP Inspect's report prompts (8 and 26) are the model. Every other module should | produce reports to the same standard. Ask Claude to 'match the report style and | monthly pack from QMP Inspect' when building each module's reports.
[/TABLE]
# 6. Power BI Across the Whole Platform
You are right that Power BI is already covered — QMP Inspect Prompt 26 builds the Jags-internal read-only connection and the monthly client packs. The standard now: every module exposes its data the same secure way, so your internal Power BI sees the entire business — all modules, all clients — in one command centre.
[TABLE]
DO  Already decided and correct | Power BI is Jags-internal only for now — you see all services, all clients. | Clients receive monthly PDF + Excel packs, not live dashboards (no client licensing). | Power BI connects to secure read-only views, never the live tables directly.
[/TABLE]
[TABLE]
Done | Power BI readiness (platform-wide) | Priority
☐ | Every module exposes secure read-only reporting views (same pattern as QMP Inspect) | HIGH
☐ | Views always include client_id so data can be sliced safely per client | CRITICAL
☐ | Power BI connects via a read-only database user or API key — Jags internal only | HIGH
☐ | No client can reach the Power BI connection or another client's data | CRITICAL
☐ | One Jags command-centre dashboard rolls up all modules and all clients | STANDARD
☐ | Connection details are documented securely for the admin (not in the app/UI) | HIGH
[/TABLE]
[TABLE]
TIP  Make it a standard for every module | When building any new module, ask Claude to 'add the secure read-only reporting | views for Power BI, following QMP Inspect Prompt 26'. That keeps every module | feeding the same internal command centre automatically.
[/TABLE]
# 7. Hosting & Running It Day-to-Day
A few practical things needed to run the platform reliably once it is live.
[TABLE]
Done | Operations readiness | Priority
☐ | Choose a reliable host (e.g. Railway, Render, AWS, Azure) — not a personal laptop | CRITICAL
☐ | Set up a staging (test) environment separate from the live one | HIGH
☐ | Automatic backups running and tested (database and files) | CRITICAL
☐ | Basic monitoring/alerts so you know if the site goes down | HIGH
☐ | A custom domain with HTTPS (e.g. app.jagsassurance.com) | HIGH
☐ | A simple process to deploy updates safely (test on staging, then release) | STANDARD
☐ | Document who to contact and what to do if something breaks | STANDARD
[/TABLE]
[TABLE]
INFO  Keep it simple to start | You do not need a big infrastructure team. Managed platforms (Railway, Render, | Supabase) handle hosting, database, and backups for a small monthly cost, so a | single developer can run this. Scale up only when client numbers justify it.
[/TABLE]
# Summary — The Path to Ready
Here is the honest, ordered path from where you are now to a platform real clients can rely on.
### Now — build and prove it
- Build QMP Inspect (guide ready), then QMP Resource. Use the simple setup. Get it working.
### Before any real data (CRITICAL items)
- Move to PostgreSQL. Cloud file storage. HTTPS on. Secrets in environment variables. Backups running and tested. Client isolation verified.
### Before external paying clients (HIGH items)
- Audit logging. 2FA for staff. Encryption at rest. Data-privacy position documented. AI assist and best-in-class reports in each module. Power BI views per module.
### As you grow (STANDARD items)
- SSO for large clients. Malware scanning. Monitoring. Staging environment. The remaining module build guides (Audit, Comply, Improve, ISO, PreQual, Train, Surveillance).
[TABLE]
BEFORE GO-LIVE  The honest bottom line | Your design is genuinely strong — in places ahead of commercial competitors on | quality-specific features. What remains is production hardening (this document) and | the 8 module guides still to be written. None of it is a flaw in the design — it is | the normal distance between an excellent specification and a live enterprise product. | Do the CRITICAL items before real data, and you are on solid, defensible ground.
[/TABLE]
JAGS ASSURANCE
jagsassurance.com  ·  Quality Management Platform