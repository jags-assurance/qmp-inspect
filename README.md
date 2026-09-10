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
   `apps/web/.env.local.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `AI_TIER`, `GEMINI_MODEL_HEAVY`,
   `GEMINI_MODEL_LIGHT` — pointed at your **production** Supabase project and a paid Gemini key once
   ready (`AI_TIER=paid` only after the target organisation's `ai_consent` is also set).
4. Every push to the connected branch redeploys automatically once these are set.

### Railway (`worker`)

1. New Railway service from this repository, **Root Directory** set to `worker`.
2. Build command: `pnpm install && pnpm --filter worker build` (or let Railway's Nixpacks
   auto-detect — it respects the pnpm workspace). Start command: `pnpm --filter worker start`.
3. Environment variables (see `worker/.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` —
   the **same production Supabase project** as the Vercel deployment.
4. Railway's own buildpack provides Chromium for Puppeteer automatically — no extra configuration
   needed there (unlike plain local dev, which may need a `PUPPETEER_EXECUTABLE_PATH` override
   depending on the machine).

### Supabase

The schema is version-controlled as plain SQL in `supabase/migrations/`, applied in filename order
via the SQL Editor or `supabase db push` (see above) — there is no separate "deploy" step beyond
keeping a real project's schema in sync with this folder as migrations are added.
