# Environments runbook

Plain guide. No secrets belong in this file.

## Where we are today

Dev and production share one Supabase project (`qbappyddqdnbwbhbzwei`). Any test, seed, or migration run against "dev" touches production data. Industry practice is to separate them before real customers rely on the system.

## Recommended layout

| Environment | Web (Vercel) | Worker (Railway) | Database (Supabase) |
| --- | --- | --- | --- |
| Production | Production deployment (main branch) | Production service | Production project (customer data) |
| Staging / Preview | Preview deployments (all other branches) | Second service "worker-staging" | Second project "jags-qmp-staging" (demo data only) |
| Local | `pnpm dev` | `pnpm --filter @jags/worker dev` | Staging project, or Supabase local stack |

Rule: production credentials are only ever set in Vercel "Production" and the production Railway service. Preview, local, and CI never see them.

## What to copy to the second project, and what not to

Copy: the schema, only through the migration files in `supabase/migrations` (see `docs/MIGRATION_REPAIR.md` and `docs/MIGRATION_DRIFT_REPORT.md`; reconcile history first). Also copy storage bucket definitions (they are created by migrations), auth settings (redirect URLs, email templates, password rules), and Edge/cron settings if any.

Do not copy: customer rows, auth users, storage files, API keys, service-role keys, webhook secrets. Generate new secrets for staging.

## Creating the staging project

1. In Supabase, create a new project (same region as production). Save its URL, anon key, and service-role key in your password manager.
2. Link the CLI to it (`supabase link --project-ref <staging-ref>`) and apply migrations in filename order. Because old migrations have naming drift, apply from a clean checkout and follow the repair guide rather than `db push` blindly.
3. Set Auth redirect URLs to the Vercel preview domain and the staging worker URL.
4. In Vercel, add the staging values for the Preview environment only (matrix below). In Railway, duplicate the worker service, name it `worker-staging`, and give it the staging variables.
5. Seed demo data only on staging (the demo users and sample ITPs in `docs/sample-itp-sources` and the seed scripts under `scripts/`). Never run seed scripts with production variables set; check `NEXT_PUBLIC_SUPABASE_URL` first.
6. Run the e2e suite only against staging (`E2E_SUPABASE_URL` must be the staging URL; `E2E_ALLOW_WRITES` stays unset elsewhere).

## Environment variable matrix

S = secret (server only, never prefix with NEXT_PUBLIC). P = public (shipped to the browser, safe to expose). "Prod" and "Preview" are the Vercel environments; "Worker" is Railway. Every Prod/Preview/Worker value must differ between production and staging for anything that points at a database, email sender, or webhook.

### Core connection

| Variable | Kind | Web Prod | Web Preview | Worker |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | P | prod project | staging project | no (uses `SUPABASE_URL`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | P | prod | staging | no |
| `NEXT_PUBLIC_SUPABASE_RESUMABLE_URL` | P, optional | prod | staging | no |
| `SUPABASE_URL` | P-ish | optional | optional | prod / staging |
| `SUPABASE_SERVICE_ROLE_KEY` | S | prod | staging | prod / staging |
| `NEXT_PUBLIC_APP_URL` | P | prod domain | preview domain | optional |
| `PUBLIC_APP_URL` | P | prod domain | preview domain | prod / staging domain (used in email links) |

### Email and notifications

| Variable | Kind | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | S | Web and worker. Staging should use a separate key restricted to a test domain, or leave unset so no real email goes out. |
| `NOTIFICATIONS_EMAIL_FROM` | P-ish | Sender address. Use a distinct sender for staging. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | P | Support contact shown in the UI. |
| `VAULT_EMAIL_WEBHOOK_SECRET` | S | Inbound email webhook. Different secret per environment. |
| `VAULT_EMAIL_ALLOWED_SENDERS` | config | Comma list of extra allowed senders. |

### AI

| Variable | Kind | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | S | Web (and worker if it calls AI). Use a separate key and quota for staging. |
| `GEMINI_MODEL_LIGHT`, `GEMINI_MODEL_HEAVY` | config | Optional overrides. |
| `AI_TIER` | config | Gate for paid-tier AI. Set to the paid tier only where licensed. |

### Monitoring and runtime

| Variable | Kind | Notes |
| --- | --- | --- |
| `SENTRY_DSN` | S-ish | Server and worker. Separate Sentry environment per deployment. |
| `NEXT_PUBLIC_SENTRY_DSN` | P | Browser DSN. |
| `CSP_REPORT_ONLY` | config | Set to `1` only to relax CSP temporarily. |
| `NEXT_PUBLIC_SITE_TIMEZONE`, `SITE_UTC_OFFSET_HOURS` | config | Default site timezone and worker escalation offset. |
| `FILE_ORG_PACKS_IN_PROJECT_VAULTS`, `FILE_PROJECT_PACKS_IN_PROJECT_VAULTS` | config | Worker auto-filing switches (`true`). |
| `PUPPETEER_EXECUTABLE_PATH`, `PLAYWRIGHT_BROWSERS_PATH` | config | Worker only, if the Chrome binary location is not the default. |
| `NODE_ENV`, `NEXT_RUNTIME`, `CI` | platform | Set by the platform. Do not set by hand. |
| `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_GIT_COMMIT_SHA`, `RAILWAY_GIT_COMMIT_SHA` | platform | Injected automatically. |

### Integration connectors (stubs, leave unset until used)

`PROJECTWISE_API_KEY` (S), `PROJECTWISE_API_BASE_URL`, `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET` (S), `ACONEX_API_KEY` (S), `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID`, `MICROSOFT_GRAPH_CLIENT_SECRET` (S). Production only when a client has licensed the connector; never reuse for staging.

### Test and tooling only (never set in Vercel or Railway)

`E2E_SUPABASE_URL`, `E2E_SUPABASE_SERVICE_ROLE_KEY` (S), `E2E_PASSWORD` (S), `E2E_ADMIN_EMAIL`, `E2E_PROJECT_ID`, `E2E_RUN_TAG`, `E2E_OUTPUT_DIR`, `E2E_ALLOW_WRITES`, `E2E_CLEANUP_*`, `BASE_URL`, `ITP_RUN_*`, `PB_PORT`, `PB_OUT`. Local shell or CI secrets only, pointed at staging.

Public variables (`NEXT_PUBLIC_*`) are embedded at build time: change them, then redeploy.

## Pre-go-live checklist

- [ ] Staging project exists, migrations applied, history reconciled (`docs/MIGRATION_DRIFT_REPORT.md` shows no unexpected differences).
- [ ] Production project holds only real data; demo users and sample data removed.
- [ ] Service-role and anon keys for production exist in Vercel Production and the production worker only. Rotate any key that was ever used in preview, local, or chat.
- [ ] Preview and local use staging values only (check `NEXT_PUBLIC_SUPABASE_URL` in each).
- [ ] Production backups and point-in-time recovery enabled; one restore rehearsed on staging.
- [ ] Auth: redirect URLs, email templates, password policy, and email confirmation set; initial admin created; default demo passwords changed.
- [ ] Email: sending domain verified (SPF, DKIM), `NOTIFICATIONS_EMAIL_FROM` set, test message delivered.
- [ ] Sentry enabled for web and worker, alerts routed to a person.
- [ ] Worker running with the production variables and a health check passing (see the system health page).
- [ ] RLS verified on all tables; advisor warnings (`get_advisors`) reviewed.
- [ ] All pending migrations applied to production in order, after a staging dry run.
- [ ] Legal pages and data-processing documents ready (`docs/PRIVACY_NOTICE.md`, `docs/SUBPROCESSORS.md`).
- [ ] Rollback plan written: previous Vercel deployment promotable, database backup timestamp noted.
