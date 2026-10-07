# JAGS Assurance — QMP Inspect

Production build of the QMP Inspect module for JAGS Assurance — a multi-tenant field-inspection
and quality-management SaaS (ITPs, checklists, NCRs, registers, data books, handover, client KPIs).

This is a separate, from-scratch build — it does not touch or replace the `prototype/` demo used
to pitch the platform to the client, or the `project_requiremnets_details/` source material; both
are kept in this repo for reference and stay available for demos independently of the real app.

## Stack & repo layout

A single pnpm-workspace monorepo, with each deployable piece as its own top-level package:

| Package | Deploys to | Purpose |
|---|---|---|
| `apps/web` | **Vercel** | Next.js 16 (App Router) frontend + Server Actions/API surface |
| `worker` | **Railway** | Node service: Puppeteer PDF/report generation, background jobs |
| `supabase` | **Supabase** | Postgres schema (migrations), RLS policies, Storage, seed data |
| `packages/shared-types` | — (shared lib) | Hand-maintained Supabase row types, consumed by both `web` and `worker` |

Reference-only, not part of the running app: `prototype/` (the client-facing demo used to sell the
platform) and `project_requiremnets_details/` (source requirements docs and UI references this
build was implemented against).

## Running the app locally

No Docker, no local Supabase stack — this project develops directly against a real (cloud)
Supabase project.

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local   # fill in your Supabase project's URL/anon key
pnpm dev
```

Opens on `http://localhost:3000`. Without real Supabase values in `.env.local` the app still boots
and shows the login page, but sign-in has nothing to authenticate against.

## Checks (lint, typecheck, tests, build)

```bash
pnpm lint         # ESLint (web). Errors fail CI; warnings (e.g. i18n literal strings) are tracked, not blocking
pnpm typecheck    # tsc --noEmit for web and worker
pnpm --filter @jags/web --filter @jags/worker test   # Vitest unit tests (root `pnpm test` also runs packages/rls-tests, which needs Supabase env)
pnpm build        # production build of apps/web
pnpm check:migrations   # new migration files must have a 14-digit numeric version
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, the migration-name check
and the build on every push to `main`/`dev` and on every pull request, and can also be started by
hand (Actions > CI > Run workflow). The tenant-isolation RLS suite runs on pull requests and needs the
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` repository secrets.

## Applying the database schema to your Supabase project

The schema lives as plain SQL in `supabase/migrations/`, applied in filename order. Two ways to run
them against your actual project — pick whichever is easier:

- **Supabase dashboard**: open the SQL Editor and paste/run each migration file in order.
- **Supabase CLI** (no Docker needed for this — only `supabase start` requires Docker, which this
  project doesn't use):
  ```bash
  npx supabase link --project-ref <your-project-ref>
  pnpm db:push
  ```

**Migration naming and history.** New migrations must be named `YYYYMMDDHHMMSS_description.sql`
(exactly 14 digits, unique) and be idempotent; never edit one that has been applied. The repo still
contains 7 duplicate versions and 30 legacy non-numeric names that were applied by hand, which
`supabase db push` ignores or rejects. Do not rename them; reconcile the live `schema_migrations`
table by following [`docs/MIGRATION_REPAIR.md`](docs/MIGRATION_REPAIR.md) before relying on
`db push`. The recently added migrations to apply, in order, are listed in
[`docs/fixes/REMAINING.md`](docs/fixes/REMAINING.md).

`supabase/seed.sql` has demo data (a JAGS staff account, a demo client org, two demo projects) —
run it the same way, after the migrations, if you want that in your project too.

## Regenerating types after a schema change

Once your project is linked (`supabase link`, above):

```bash
pnpm db:types
```

Writes `packages/shared-types/src/database.ts` from your Supabase project's actual schema — run
this after every migration. Until then, that file is hand-maintained to match the migrations
exactly (see the comment at its top).

## Deployment

### Vercel (`apps/web`)

1. Import this repository into Vercel.
2. Set the project's **Root Directory** to `apps/web` (Vercel builds only that package, not the
   whole monorepo — pnpm workspaces are auto-detected from the root `pnpm-lock.yaml`).
3. Environment variables (Project Settings → Environment Variables): everything listed in
   `apps/web/.env.local.example` — at minimum `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (required for party provisioning,
   non-staff recipient lookups, the deep `/api/health` check and the sign-in throttle) and
   `NEXT_PUBLIC_APP_URL` (reset-password links, QR codes); plus `GEMINI_API_KEY`, `AI_TIER`,
   `GEMINI_MODEL_HEAVY`, `GEMINI_MODEL_LIGHT`, `RESEND_API_KEY`/`NOTIFICATIONS_EMAIL_FROM` and
   `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` as needed. The full table is in
   [`docs/OPERATIONS_RUNBOOK.md`](docs/OPERATIONS_RUNBOOK.md) — pointed at your **production** Supabase project and a paid Gemini key once
   ready (`AI_TIER=paid` only after the target organisation's `ai_consent` is also set).
4. Every push to the connected branch redeploys automatically once these are set.

### Railway (`worker`)

1. New Railway service from this repository, **Root Directory left as the repo root** (not
   `worker`) — `worker/package.json` depends on `@jags/shared-types` via `workspace:*`, which only
   resolves with the root `pnpm-workspace.yaml`/`pnpm-lock.yaml` in scope.
2. Build command: `pnpm install && pnpm --filter @jags/worker build`. Start command:
   `pnpm --filter @jags/worker start`. Watch Paths: `/worker/**` (avoids redeploying this service on
   unrelated `apps/web` pushes).
3. Environment variables (see `worker/.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` —
   the **same production Supabase project** as the Vercel deployment — and `PUBLIC_APP_URL` (or
   `NEXT_PUBLIC_APP_URL`) so PDFs can carry QR-code links. Optional: `SENTRY_DSN`,
   `SITE_UTC_OFFSET_HOURS` (default +4), `PUPPETEER_EXECUTABLE_PATH`. Redeploy the worker after any
   change under `worker/` or to a PDF template (it bundles the fonts and the `qrcode` package).
4. Puppeteer's headless Chrome needs two things Railway's plain Nixpacks Node image does not provide
   on its own, both already committed at the repo root — nothing further to configure:
   - `package.json`'s `pnpm.onlyBuiltDependencies: ["puppeteer"]` — pnpm 10 silently skips a
     dependency's `postinstall` script (which is how Puppeteer downloads its own Chrome build)
     unless it's explicitly allowed here; without it, `pnpm install` "succeeds" but no Chrome ever
     gets downloaded, and every PDF-rendering job fails at runtime with "Could not find Chrome".
   - `nixpacks.toml`'s `aptPkgs` — the shared libraries (`libnss3`, `libatk-bridge2.0-0`, etc.)
     headless Chrome needs just to launch on Linux; a bare Nixpacks Node image has none of them.
   If a job still fails with "Could not find Chrome" after these, check the Railway build logs for
   the "Ignored build scripts" warning — if it's still there, `onlyBuiltDependencies` didn't take
   effect (e.g. a stale build cache) and a clean redeploy is worth trying.

### Health check

`GET /api/health` is unauthenticated and returns only statuses, latencies and a short build id
(no secrets or error text): database, storage, schema probe and worker (pending-job age). HTTP 503 means
the database or storage failed; `degraded` means the worker looks stalled. Point the uptime monitor at it.

### Supabase

The schema is version-controlled as plain SQL in `supabase/migrations/`, applied in filename order
via the SQL Editor or `supabase db push` (see above) — there is no separate "deploy" step beyond
keeping a real project's schema in sync with this folder as migrations are added.
