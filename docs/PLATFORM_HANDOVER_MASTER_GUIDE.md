---
title: "JAGS QMP Inspect: Platform, Setup and Handover Guide"
---

<div class="cover">
<div class="kicker">JAGS ASSURANCE · QMP INSPECT</div>
<h1 class="covertitle">Platform, Setup and Handover Guide</h1>
<p class="coversub">What the client needs, how to set it up from scratch, how to hand it over, and how the developer keeps it running. One document, for the client and for the developer.</p>
<table class="meta">
<tr><td>Audience</td><td>Client owner and IT contact (Parts 1, 2, 5, 6) · Developer (all parts)</td></tr>
<tr><td>Status</td><td>Application complete and tested. Go-live preparation.</td></tr>
<tr><td>Prices</td><td>Indicative, USD per month, from vendor and third-party pages. Confirm before ordering.</td></tr>
</table>
</div>

<div class="pagebreak"></div>

# Contents

1. The system at a glance
2. Platforms the client needs, and why
3. Accounts, ownership and access
4. Setup from scratch, step by step
5. Verification: proving it works
6. Handover package and sign-off
7. Running it: monitoring, backups, updates, cost
8. Developer guide: how it fits together, and the next module
9. Troubleshooting: real problems we met and their fixes
10. Reporting with Power BI
11. Checklists and reference

<div class="pagebreak"></div>

# 1. The system at a glance

JAGS QMP Inspect manages inspection and test plans (ITPs), site inspections, non-conformance reports (NCRs), punch lists, sign-offs, Data Books and handover certificates for engineering projects. It is a web application with a database, a background worker that builds PDFs, and email notifications.

<svg viewBox="0 0 780 330" xmlns="http://www.w3.org/2000/svg" class="diagram" role="img" aria-label="Architecture">
<style>
.b{fill:#fff;stroke:#6B1E2C;stroke-width:1.6}
.t{font:700 13px Arial;fill:#222;text-anchor:middle}
.s{font:11px Arial;fill:#555;text-anchor:middle}
.a{stroke:#555;stroke-width:1.5;fill:none;marker-end:url(#h)}
.d{stroke:#6B1E2C;stroke-width:1.5;fill:none;stroke-dasharray:5 4;marker-end:url(#h)}
.l{font:10px Arial;fill:#6B1E2C;text-anchor:middle}
</style>
<defs><marker id="h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker></defs>
<rect class="b" x="10" y="125" width="120" height="62" rx="8"/><text class="t" x="70" y="152">Users</text><text class="s" x="70" y="170">Browser, phone</text>
<rect class="b" x="190" y="125" width="130" height="62" rx="8"/><text class="t" x="255" y="152">Cloudflare</text><text class="s" x="255" y="170">Domain and DNS</text>
<rect class="b" x="380" y="125" width="150" height="62" rx="8"/><text class="t" x="455" y="152">Vercel</text><text class="s" x="455" y="170">Web app (Next.js)</text>
<rect class="b" x="600" y="125" width="170" height="62" rx="8"/><text class="t" x="685" y="152">Supabase</text><text class="s" x="685" y="170">Database, logins, files</text>
<rect class="b" x="380" y="14" width="150" height="62" rx="8"/><text class="t" x="455" y="41">Resend</text><text class="s" x="455" y="59">Email delivery</text>
<rect class="b" x="600" y="250" width="170" height="62" rx="8"/><text class="t" x="685" y="277">Railway worker</text><text class="s" x="685" y="295">PDFs, jobs, 15-min sweep</text>
<path class="a" d="M130,156 L190,156"/><text class="l" x="160" y="146">name</text>
<path class="a" d="M320,156 L380,156"/><text class="l" x="350" y="146">HTTPS</text>
<path class="a" d="M530,156 L600,156"/><text class="l" x="565" y="146">data</text>
<path class="a" d="M455,125 L455,76"/><text class="l" x="487" y="104">sends mail</text>
<path class="a" d="M685,250 L685,187"/><text class="l" x="722" y="222">reads jobs,</text><text class="l" x="722" y="234">saves PDFs</text>
<path class="d" d="M600,281 L490,281 L490,187"/><text class="l" x="545" y="298">automation call (secret)</text>
</svg>

**How a request flows.** A user opens the app address. Cloudflare resolves the name to Vercel. Vercel runs the application, reading and writing data in Supabase under the user's own permissions. When someone asks for a PDF, the app writes a job to Supabase; the Railway worker picks it up, builds the PDF with a headless browser, and stores it back in Supabase. Every 15 minutes the worker also calls the app's automation route, which sends sign-off reminders and handles "proceed without response". Resend delivers the emails.

**Why this matters for the client.** The five services are independent. Any one can be replaced without rebuilding the others, and the client owns the accounts, the data and the domain throughout.

# 2. Platforms the client needs, and why

| Platform | Job in the system | Recommended plan | Cost / month | Why this choice | Without it |
|---|---|---|---|---|---|
| **Supabase** | Database, logins, file storage (photos, PDFs, vault), daily backups | **Pro** | $25 | The free plan throttles disk activity and pauses idle projects. That caused repeated slowdowns and outages during testing. Pro adds daily backups and steady performance. | No application |
| **Vercel** | Hosts the web application | **Pro**, 1 seat to start | $20 per seat | Built for this kind of Next.js app; needs the paid plan for commercial use; automatic deploys and previews | No website |
| **Railway** | Runs the PDF and report worker and the 15-minute automation | **Hobby**, move to Pro if usage grows | $5–20 plus usage | The worker needs a long-running server with a browser engine, which serverless hosting does not suit | No PDFs, no reminders |
| **Resend** | Sends email notifications | **Pro** | $20 | Free plan allows 100 emails a day; busy sign-off days could exceed it | No emails (in-app notices still work) |
| **Cloudflare** | Domain registration and DNS | Free DNS; domain about $10 a year | about $1 | Domain at cost; the client owns the name; moving hosts later is one record change | No custom address |
| **GitHub** | Holds the code; Vercel and Railway deploy from it | Free organisation | $0 | The client owns the source; deployments are traceable | No updates possible |
| **Power BI** | Management dashboards | **Pro**, only for people who publish or view | $14 per user | Ten ready-made database views feed it | No dashboards (app reports still work) |

**Estimated platform total:** about **$70–85 per month**, plus Power BI per user. The optional point-in-time database recovery costs $100 a month per 7 days of history; daily backups are already included.

**Alternatives considered**

| Option | Cost | Verdict |
|---|---|---|
| Everything on Railway (web app too) | about $55–70 | Workable and cheaper, but loses previews and the global network, and the server's memory must be managed by hand. Worth a trial if cost matters most. |
| Free plans throughout | $0–5 | Demo only. Throttling, idle pauses, no backups, Vercel free is non-commercial. Not suitable for go-live. |
| Enterprise tiers | $400+ | Only if the client's IT requires single sign-on, security certificates or a support guarantee. Needs a quote. |

# 3. Accounts, ownership and access

**Rule: the client owns every account. The developer is a member with limited rights.** This protects the client from depending on one person, and protects the developer from carrying the client's billing and risk.

| Account | Client role | Developer role | Never give the developer |
|---|---|---|---|
| GitHub organisation | Owner | Write | Owner |
| Supabase organisation | Owner | Developer | Owner, billing |
| Vercel team | Owner | Member | Billing |
| Railway project | Owner | Member | Billing |
| Cloudflare | Owner | None, or DNS-only if needed | Registrar control |
| Resend | Owner | None after setup | API key in chat or email |
| Power BI | Owner of the workspace | Contributor | — |

**Good practice for every account**
- Register with a shared company mailbox (for example it@clientdomain.com), never one person's address.
- Two-step login on, with the recovery codes stored in the client's password manager.
- Auto-renew on for the domain and cards on file for the paid plans.
- Secrets (database keys, the cron secret, the email key) are stored in the password manager and in each platform's settings, never in the code repository and never sent by email or chat.

**Agreement.** Record in writing what the developer may do afterwards (support, fixes, the next module, response time), that the client can remove access at any time, and who pays for what.

# 4. Setup from scratch, step by step

Order matters. Each step lists what to do and why.

## Step 1. Create the accounts

For each platform: sign up with the shared mailbox, turn on two-step login, store the password. Create a **Supabase organisation on the Pro plan**, a **Vercel team on Pro**, a **Railway project on Hobby**, a **Resend account**, a **Cloudflare account**, and a **GitHub organisation**. Invite the developer with the limited roles in Part 3.

*Why first:* everything after this depends on the client already owning the accounts.

## Step 2. Move the code into the client's GitHub

Create an empty private repository (for example `qmp-inspect`) in the client's organisation. From the developer's copy, add it as a remote and push the `main` branch. Check that no `.env` file or key is in the history.

*Why:* Vercel and Railway deploy from this repository, so it decides who controls updates.

## Step 3. Register the domain

In Cloudflare, Domain Registration, Register Domains. Choose a name, pay, switch auto-renew on. If the ending is not available, register elsewhere and set that registrar's name servers to Cloudflare's.

*Why:* the client must own the name outright. A lapsed domain takes down the app and email.

## Step 4. Create and prepare the database (Supabase)

1. Create a new project in the client's organisation, choosing the region closest to site users and inside any client data-location rule. **The region cannot be changed later.** Save the database password.
2. Copy the live schema into it. The repository holds 285 migration files that include duplicates and hand-applied names, so replaying them on an empty project is risky. The safer route is a schema-only dump from the working project, restored into the new one:
   - `npx supabase db dump --db-url "<current connection string>" -f schema.sql`
   - Run `schema.sql` in the new project's SQL Editor.
   - Run `supabase/RUN_ONCE_phase5_notifications_realtime.sql`. If a storage bucket policy is missing, run `supabase/RUN_ONCE_missing_storage_policies.sql`.
3. **Trial it first** on a throwaway free project and click through the app. This route has not been run on a blank project yet.
4. Authentication settings: set the Site URL to `https://qmp.clientdomain.com` and add it to Redirect URLs; paste the email templates from `supabase/templates/`; minimum password length 12; email confirmation on.
5. Create the real Admin account (Authentication, Users, Add user), mark it as JAGS staff admin (see `docs/OPERATIONS_RUNBOOK.md`), sign in and set a new password. Create the scoped Field Engineer account from the Staff access page, limited to the organisations that person should see.
6. **Do not load `supabase/seed.sql`.** It creates demo accounts that share one password.
7. Confirm daily backups are on (Settings, Database, Backups).
8. Note three values from Settings, API: the **Project URL**, the **anon key** and the **service_role key**. The service_role key bypasses all permissions, so it goes only into server settings.

*Why:* the database is the heart of the system. Its permission rules (row-level security) are part of the schema, so copying the schema carries them over.

## Step 5. Generate the shared secrets

Make a long random string (about 40 characters) for `CRON_SECRET`. The same value goes into both Railway and Vercel. Make another for `VAULT_EMAIL_WEBHOOK_SECRET` if email-to-vault is used.

*Why:* the worker proves to the web app that it may call the automation route. If the two values differ, the route answers 401; if the web app has none, it answers 503.

## Step 6. Deploy the worker (Railway)

1. New Project, Deploy from GitHub repo, the client repository, branch `main`, root directory the repository root.
2. Build command: `pnpm install && pnpm --filter @jags/worker build` (this also installs the Chrome used for PDFs).
3. Start command: `pnpm --filter @jags/worker start`. Watch path: `/worker/**`.
4. Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_APP_URL` (the final app address), `CRON_SECRET`, plus `RESEND_API_KEY` and `NOTIFICATIONS_EMAIL_FROM`. Optional: `SENTRY_DSN`, `SITE_UTC_OFFSET_HOURS`.
5. Deploy and read the log for the Chrome install and the worker start line.

*Why:* PDF building needs a browser engine and can take many seconds, which suits a long-running server.

## Step 7. Deploy the web app (Vercel)

1. Add New, Project, import the client repository. **Root Directory: `apps/web`.** Region: closest to users (currently Singapore).
2. Production variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `NOTIFICATIONS_EMAIL_FROM`, `NEXT_PUBLIC_SUPPORT_EMAIL`. Only if the AI ITP drafting is used: `GEMINI_API_KEY`, `AI_TIER`, `GEMINI_MODEL_HEAVY`, `GEMINI_MODEL_LIGHT`. Optional: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`.
3. Deploy, then Settings, Domains, add `qmp.clientdomain.com`. Vercel shows the DNS record to create.

## Step 8. Connect the domain and email

1. In Cloudflare DNS, add the record Vercel showed (usually a CNAME for `qmp`). Set it to **DNS only** (grey cloud). The orange proxy can cause certificate errors and redirect loops with Vercel.
2. In Resend, add the client's domain. Resend shows SPF, DKIM and optional DMARC records. Add each in Cloudflare as DNS only, then press Verify.
3. Wait for HTTPS to show valid in Vercel (a few minutes).

*Why:* without verified email records, messages from the system land in spam or are rejected.

# 5. Verification: proving it works

Do all of these before announcing go-live.

| Check | How | Pass |
|---|---|---|
| Health | Open `/api/health` | `status: ok`; database, schema, storage and worker all ok; `build` shows the commit |
| Admin login | Sign in as the new Admin | Dashboard loads; no demo accounts exist |
| Scoped login | Sign in as the Field Engineer | Sees only the assigned organisations |
| Core flow | Create an organisation, project and ITP | Saves without error |
| PDF | Generate an ITP PDF | Arrives with the JAGS logo and correct text |
| Email | Add a party with a login | Invite arrives from the client's domain, not in spam |
| Automation | Vercel, Logs, path `/api/cron/signoff-automation` | Status 200 about every 15 minutes (401 = secrets differ; 503 = `CRON_SECRET` missing in Vercel) |
| Reports | Power BI refresh with the read-only user | Succeeds |
| Backups | Supabase, Backups | A daily backup is listed |
| Security | Open the site and check HTTPS | Valid certificate; security headers present |

# 6. Handover package and sign-off

Give the client one folder (or one shared document) containing:

1. **Account register:** each platform, the account owner, the login mailbox, the plan, the renewal date.
2. **Secrets location:** where each key is stored (password manager entry names), never the keys themselves in the document.
3. **Cost sheet:** monthly cost per platform and the total, with the renewal dates.
4. **Architecture one-pager:** the diagram in Part 1 and who to call for each part.
5. **Restore procedure:** how to restore a backup and who performs it.
6. **User accounts:** list of Admin and staff accounts, with confirmation that demo accounts are removed.
7. **Test evidence:** the verification table in Part 5, completed and dated.
8. **Developer access record:** which roles the developer holds, and how the client removes them.
9. **Support agreement:** scope, response times, charges.

**Sign-off.** The client confirms in writing: accounts received and owned by them; verification passed; developer roles as agreed; documents received. Date and sign.

# 7. Running it: monitoring, backups, updates, cost

**Monitoring.** Point an uptime monitor (for example a free one) at `/api/health` every 5 minutes with an email alert. `503` means the database or storage failed; `degraded` means the worker looks stalled. Optionally switch on Sentry error tracking by setting its address in both Vercel and Railway.

**Backups.** Supabase Pro keeps daily backups. Test a restore into a throwaway project once after go-live and once a year. Add point-in-time recovery only if the client needs to restore to a specific minute.

**Updates.** Code changes go to a staging copy first, then to production. Vercel redeploys on each push to the production branch; Railway redeploys only when files under `worker/` change. Database changes are forward-only migrations: take a backup, apply, check, and never edit a migration that has already been applied.

**Monthly review (10 minutes).** Check the Supabase usage page for disk, bandwidth and size; the Vercel usage page; the Railway usage page; the Resend sent count; and the list of failed background jobs.

**Cost control.** Costs grow with users, photos and PDFs. The things to watch are Supabase storage and bandwidth, Railway memory and Resend volume. The estimated total is $70–85 a month before Power BI.

**Security routine.** Review Admin and staff accounts each quarter. Remove people who have left. Rotate the keys if anyone with access leaves. Keep two-step login on everywhere.

# 8. Developer guide: how it fits together, and the next module

## 8.1 Repository map

| Path | What it is |
|---|---|
| `apps/web` | The Next.js web application (pages, server actions, components) |
| `worker` | The Railway worker: PDF templates, background jobs, sign-off sweep |
| `supabase/migrations` | The database schema as ordered SQL files |
| `supabase/templates` | Authentication email templates |
| `packages/shared-types` | Shared database types |
| `docs` | Operations runbook, test guides, Power BI notes, this guide |

## 8.2 Why it is built this way

- **The database enforces permissions.** Row-level security means a user can only read what their role allows, even if the application had a bug. The app talks to the database as the signed-in user, not as an all-powerful account. The service key is used only for the few jobs that have no user (the worker, invitations).
- **A separate worker for PDFs.** Building a PDF takes seconds and needs a browser engine. Serverless hosting has time limits that would cut these off, so a small always-on service does the work and the web app stays fast.
- **Everything is traced.** Sign-offs, NCRs, punch items and changes write to an audit log, which supports client audits.
- **Forward-only migrations.** The schema only moves forward. A mistake is fixed by a new migration, never by editing an old one.

## 8.3 Environment variables reference

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | Browser-safe database address and key |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, Railway | Server-only key that bypasses permissions. Never expose. |
| `SUPABASE_URL` | Railway | Database address for the worker |
| `NEXT_PUBLIC_APP_URL`, `PUBLIC_APP_URL` | Vercel, Railway | Public address; used in emails, QR codes and the sweep |
| `CRON_SECRET` | Vercel, Railway | Shared secret for the automation route |
| `RESEND_API_KEY`, `NOTIFICATIONS_EMAIL_FROM` | Vercel, Railway | Email sending; sender must be a verified domain |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Vercel | Shown on the help page |
| `GEMINI_API_KEY`, `AI_TIER`, `GEMINI_MODEL_*` | Vercel | Optional AI ITP drafting |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Vercel, Railway | Optional error tracking |
| `SITE_UTC_OFFSET_HOURS`, `WORKER_CONCURRENCY` | Railway | Worker tuning |

## 8.4 Building the next module safely

1. **Staging first.** Create a second Supabase project (the free plan is fine for staging) and use Vercel's preview deployments. Never develop on the live database.
2. **Work on a branch.** Merge to the production branch only after tests pass and the change has been tried on staging.
3. **Database changes.** Write a new migration file named `YYYYMMDDHHMMSS_description.sql`, make it safe to run twice, and read it fully before applying. Back up production first. After applying, regenerate types with `pnpm db:types`.
4. **Tests.** Run the unit tests (`pnpm test` in `apps/web` and `worker`) and the type check before every push. The suite currently passes (web 1480, worker 254 tests).
5. **Release.** Apply the migration to production in a quiet period, then push the code. Check `/api/health` and the Vercel logs straight after.
6. **Rollback.** Code: redeploy the previous Vercel build. Database: write a compensating migration or restore the backup.

## 8.5 Why this model helps the client and the developer

- **Client:** owns the data, the code and the domain; can replace the developer or any platform; pays the platforms directly so costs are transparent.
- **Developer:** no billing exposure; a clean staging area so a mistake never touches client data; written scope for support and new modules.
- **Both:** every change is traceable in GitHub and deployments, and the handover record shows exactly who can do what.

# 9. Troubleshooting: real problems we met and their fixes

| Symptom | Cause | Fix |
|---|---|---|
| Pages slow, "Something went wrong", health error with 5-second timeouts | Supabase free plan ran out of disk activity budget | Move to Pro. Short term: stop heavy use and wait; Restart project does not refill the budget |
| Health shows database ok but a page returns 502 after 31 seconds | Database was throttled during the page's queries | Same as above; pages that load many records also benefit from the extended time limit already set |
| PDF fails with "Could not find Chrome" | The Chrome download was skipped in a cached build | Redeploy the worker with a clean build. The build command installs Chrome |
| Automation route returns 401 | `CRON_SECRET` differs between Vercel and Railway | Set identical values and redeploy both |
| Automation route returns 503 | `CRON_SECRET` is not set in Vercel | Add it and redeploy |
| Power BI "EMAXCONNSESSION" | Session pooler allows 15 connections | Use the transaction pooler on port 6543; turn off parallel loading |
| Power BI certificate error | Supabase root certificate not trusted | Install the Supabase root certificate on the computer |
| Power BI login fails | Wrong user format | Use `powerbi_reader.<project-ref>`; do not use the owner account |
| Production build fails on the icon | Favicon must have a transparency channel | Use an RGBA `.ico` |
| Emails land in spam | Sender domain records not verified | Add SPF and DKIM in Cloudflare as DNS only; verify in Resend |
| HTTPS or redirect loop on the domain | Cloudflare proxy turned on | Set the record to DNS only |
| Users cannot sign in after the move | Site URL or redirect URLs not updated | Update them in Supabase Authentication, URL Configuration |
| A completed project refuses changes | By design: completed projects lock | Reopen only through the documented process |

# 10. Reporting with Power BI

**Recommended mode.** Import with scheduled refresh every 1 to 4 hours. It loads data in a few queries rather than one per click, which keeps the database fast for site users. Use DirectQuery only for one small "live today" page, and only on Supabase Pro.

**Connection.** Server: the Supabase pooler host. Port: **6543** (transaction pooler). Database: `postgres`. User: `powerbi_reader.<project-ref>`. Install the Supabase root certificate. Turn parallel loading off.

**Views to load (ten)**

| View | Use |
|---|---|
| `vw_powerbi_activity_fact` | Main fact table of activities |
| `vw_powerbi_itp_completion` | ITP progress |
| `vw_powerbi_inspections_completed_vs_planned` | Planned against done |
| `vw_powerbi_inspection_attempts` | Failures and re-inspections |
| `vw_powerbi_first_time_pass_rate` | Quality by activity and contractor |
| `vw_powerbi_signoff_turnaround` | Sign-off speed |
| `vw_powerbi_hold_point_turnaround` | Time spent at hold points |
| `vw_powerbi_ncr_trends` | NCR counts, severity, ageing |
| `vw_powerbi_punch_list_and_fat` | Punch items and FAT status |
| `vw_powerbi_databook_completeness` | Data Book readiness |

**Suggested report pages:** executive summary; inspection quality; sign-off speed; NCR and observation trends; punch list and FAT; Data Book readiness; contractor scorecard.

**Licences.** Power BI Desktop is free for building. People who publish or view shared reports need Power BI Pro.

# 11. Checklists and reference

## Go-live checklist

- [ ] All accounts created in the client's name, two-step login on
- [ ] Code in the client's GitHub organisation
- [ ] Supabase Pro project in the chosen region; schema restored; daily backups on
- [ ] Real Admin and scoped Field Engineer accounts created; **no demo accounts**
- [ ] Railway worker deployed; Chrome installed; logs healthy
- [ ] Vercel app deployed with all variables; domain live with HTTPS
- [ ] Same `CRON_SECRET` on both; cron route returns 200
- [ ] Resend domain verified; real email received
- [ ] `/api/health` ok; uptime monitor set
- [ ] Verification table (Part 5) completed and dated
- [ ] Handover package (Part 6) delivered and signed

## Decisions the client must confirm

1. Data region for the database.
2. Domain name and ending.
3. Number of Vercel seats and Power BI licences.
4. Whether point-in-time recovery is required.
5. Clean start, or carry over existing projects.
6. Whether enterprise features (single sign-on, security reports, support guarantee) are required.

## Glossary

| Term | Meaning |
|---|---|
| ITP | Inspection and test plan |
| NCR | Non-conformance report |
| Hold point | A step work cannot pass until it is signed |
| Data Book | The compiled, issued record of a project's inspections and documents |
| IRN | Inspection release note |
| RLS | Row-level security: permission rules inside the database |
| Service key | A database key that bypasses permissions; server use only |
| Worker | The background service that builds PDFs and runs scheduled jobs |
| Migration | A numbered SQL file that changes the database schema |
| Staging | A safe copy of the system used for testing changes |
