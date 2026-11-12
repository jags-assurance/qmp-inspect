# Client platform setup and transfer (from scratch)

Goal: run JAGS QMP Inspect entirely on accounts the **client owns**, with the developer as a limited member.
Order matters: accounts, then database, then worker, then web app, then domain and email, then checks.

Prices are indicative; confirm on each vendor's pricing page.

## 0. Decisions before you start

| Decision | Recommendation |
|---|---|
| Code home | A GitHub **organisation owned by the client**. Vercel and Railway deploy from it. |
| Data | Clean start (schema only, no sample or test rows). Carry over real projects only if the client asks. |
| Supabase region | The region closest to site users and inside any client data-location rule. It cannot be changed later. |
| Domain | One subdomain, for example `qmp.clientdomain.com`. Registered in the client's Cloudflare. |
| Shared mailbox | One company address (for example `it@clientdomain.com`) used to register every account, so ownership never depends on one person. |

## 1. Create the accounts (client does this, then invites the developer)

For each, use the shared mailbox, turn on two-step login, and save the password in the client's password manager.

1. **GitHub**: create an organisation. Settings, Billing: free plan is enough. Invite the developer with the *Write* (not Owner) role.
2. **Cloudflare**: sign up, then Domain Registration, Register Domains. Choose the name, pay, switch auto-renew on. If the ending is not offered, register elsewhere and change that registrar's name servers to Cloudflare's two.
3. **Supabase**: sign up, create an **Organization**, choose the **Pro** plan ($25/month), then create a **Project** in the chosen region. Save the database password. Invite the developer as *Developer* (not Owner).
4. **Railway**: sign up with GitHub, choose Hobby ($5) to start. Create a Project. Invite the developer as a member.
5. **Vercel**: sign up with GitHub, choose **Pro** ($20 per seat). Create a Team. Invite the developer as *Member*.
6. **Resend**: sign up, then Domains, Add Domain (the client's domain). Create an API key with *Sending access*.

## 2. Move the code to the client's GitHub

1. In the client's organisation create an empty private repository, for example `qmp-inspect`.
2. From your copy: `git remote add client <new-repo-url>` then `git push client main` (and `dev` if wanted).
3. Do not copy secrets: no `.env` files are in the repository, and none should be committed.

## 3. Database (Supabase)

**Recommended method for a new project: copy the live schema, not replay the 285 migration files.** The repository has duplicate and non-numeric migration names that were applied by hand, so a blind replay on an empty project is risky. Replaying has not been tested on a blank project.

1. In the *current* Supabase project: Settings, Database, copy the connection string for the **direct** connection (or session pooler).
2. From a computer with the Supabase CLI or `pg_dump`:
   - `npx supabase db dump --db-url "<current connection string>" -f schema.sql` (schema only; no data).
   - Also dump the roles and storage settings if the CLI offers it. Storage buckets and their policies must exist; if a bucket is missing, run `supabase/RUN_ONCE_missing_storage_policies.sql`.
3. In the *new* project: SQL Editor, paste and run `schema.sql`. Then run `supabase/RUN_ONCE_phase5_notifications_realtime.sql`.
4. **Trial first**: do steps 2 and 3 once into a throwaway free project and click through the app before touching the client's project.
5. In the new project, Authentication:
   - URL Configuration: Site URL = the app address (`https://qmp.clientdomain.com`); add the same to Redirect URLs.
   - Email templates: paste the files from `supabase/templates/` (confirmation, invite, recovery, magic link, email change).
   - Password rules: minimum 12 characters; turn on email confirmation.
6. Create the first Admin: Authentication, Users, Add user. Then in SQL Editor mark the user as JAGS staff admin (see the app's `docs/OPERATIONS_RUNBOOK.md`). Sign in once and set a new password.
7. Create the scoped Field Engineer account from the Staff access page, restricted to the organisations they should see.
8. **Do not load `supabase/seed.sql`.** It creates demo accounts with a shared password.
9. Create the Power BI user: SQL Editor, `create role powerbi_reader login password '<strong password>';` then grant select on the ten `vw_powerbi_*` views only. Connect Power BI through the transaction pooler (port 6543), user `powerbi_reader.<project-ref>`.
10. Settings, Database, Backups: confirm daily backups are on (included with Pro). Point-in-time recovery is an optional add-on.

Keep from Supabase Settings, API: the **Project URL**, the **anon** key and the **service_role** key.

## 4. Generate the secrets

- `CRON_SECRET`: any long random string (for example 40 random characters). The same value goes in Railway and Vercel.
- `VAULT_EMAIL_WEBHOOK_SECRET`: another random string (only used if email-to-vault is switched on).

## 5. Worker (Railway)

1. Railway, New Project, Deploy from GitHub repo, choose the client repository, branch `main`.
2. Root directory: the repository root (not `worker`).
3. Build command: `pnpm install && pnpm --filter @jags/worker build` (the build also downloads Chrome).
4. Start command: `pnpm --filter @jags/worker start`.
5. Watch paths: `/worker/**`.
6. Variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PUBLIC_APP_URL` = `https://qmp.clientdomain.com`
   - `CRON_SECRET`
   - `RESEND_API_KEY`, `NOTIFICATIONS_EMAIL_FROM` (if the worker sends mail)
   - optional: `SENTRY_DSN`, `SITE_UTC_OFFSET_HOURS`
7. Deploy. In the logs look for the Chrome install and a worker start line. A "Could not find Chrome" error means a clean redeploy is needed.

## 6. Web app (Vercel)

1. Vercel, Add New, Project, import the client repository. **Root Directory: `apps/web`.** Region: closest to users (current setting is Singapore, `sin1`, in `vercel.json`).
2. Environment variables (Production):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL` = `https://qmp.clientdomain.com`
   - `CRON_SECRET` (same as Railway)
   - `RESEND_API_KEY`, `NOTIFICATIONS_EMAIL_FROM` (for example `JAGS Assurance <notifications@clientdomain.com>`)
   - `NEXT_PUBLIC_SUPPORT_EMAIL`
   - `GEMINI_API_KEY`, `AI_TIER`, `GEMINI_MODEL_HEAVY`, `GEMINI_MODEL_LIGHT` only if the AI ITP draft is used (use a paid key and `AI_TIER=paid` only after the organisation has given AI consent)
   - optional: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`
3. Deploy. Settings, Domains, Add `qmp.clientdomain.com`. Vercel shows the DNS record to create.

## 7. Domain and email (Cloudflare and Resend)

1. Cloudflare, DNS, add the record Vercel asked for (usually a CNAME for `qmp`). Set it to **DNS only** (grey cloud).
2. Resend shows SPF, DKIM and optionally DMARC records for the domain. Add each in Cloudflare as **DNS only**, then press Verify in Resend.
3. Wait for HTTPS to show as valid in Vercel (a few minutes).

## 8. Checks (do all of them)

| Check | Pass |
|---|---|
| `https://qmp.clientdomain.com/api/health` | `status: ok`; database, schema, storage, worker all ok; `build` shows the commit |
| Sign in as Admin | Dashboard loads; no demo accounts exist |
| Sign in as the scoped Field Engineer | Sees only the assigned organisations |
| Create an organisation, project and ITP | Saves without error |
| Generate an ITP PDF | Worker builds it with the JAGS logo |
| Add a party with a login | Invite email arrives from the client's domain, not in spam |
| Cron | Vercel, Logs, filter the path `/api/cron/signoff-automation`: status 200 every 15 minutes. 401 = secrets differ; 503 = `CRON_SECRET` missing in Vercel |
| Power BI | Refresh succeeds with `powerbi_reader` |
| Backups | Supabase shows a daily backup |

## 9. Transfer and developer access

1. The client is **Owner** on every account. The developer is invited with limited roles:
   GitHub *Write*, Vercel *Member*, Railway *Member*, Supabase *Developer*. No billing access anywhere.
2. Hand over a one-page record: each account and its owner; where the passwords and keys are stored; monthly cost; restore steps; who to call.
3. For the next module, use a **separate staging Supabase project** and Vercel preview deployments. Apply new migrations to staging, test, then to production after a backup. Never develop on the live database.
4. Agree in writing what the developer may do afterwards (support, fixes, new modules, response time) and that the client can remove access at any time.

## 10. Before announcing go-live

- [ ] No demo or test logins remain; all passwords are new and unique.
- [ ] Real Admin and Field Engineer accounts exist.
- [ ] Resend domain verified; a real email received.
- [ ] Cron returns 200 in the Vercel logs.
- [ ] Daily backups confirmed in Supabase.
- [ ] Domain auto-renew on; two-step login on every account.
- [ ] The client has the access record from section 9.
