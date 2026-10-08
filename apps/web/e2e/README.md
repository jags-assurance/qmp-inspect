# QMP end-to-end suite (read-only by default; write specs are gated)

Playwright tests that drive the **deployed** web app in a real browser.

* **`01`-`04` are read-only.** They sign in with the seeded demo accounts and only navigate and read. The
  sign-in form is the only form ever submitted; no server action is called, and every spec asserts that no
  write request (a `Next-Action` POST or a non-GET `/api/*` call) was made. Sign-in itself leaves the usual
  footprint (an auth session and one `sign_in` audit event per login). Nothing else changes.
* **`05-*` are write specs and are SKIPPED unless `E2E_ALLOW_WRITES=1`.** They create, change and close real
  records on the site under test, all inside an organisation and projects named `E2E-...`, and a separate
  script removes exactly those records afterwards. See [Write specs](#write-specs-05--gated-off-by-default)
  below for the flags and the safety rules. A plain `pnpm e2e` (and the CI job) therefore stays read-only.

## What is covered

| Spec | Covers |
|---|---|
| `01-login.spec.ts` | Sign-in page renders; protected URLs redirect to `/login?next=`; health endpoint; **login for all 7 demo roles and the landing page each one gets** (`/platform` for the JAGS Admin, `/inspect` for everyone else) |
| `02-access.spec.ts` | Admin-only pages (`/inspect/organisation/usage`, `/inspect/organisation/staff-access`, `/platform`) open for the Admin and redirect everyone else to `/inspect`; staff-only pages (`start-work`, `settings`) and the client/staff-only handover portal redirect the wrong roles; a project the role has no grant on is not reachable by URL |
| `03-list-pages.spec.ts` | Every role opens each key list page (dashboard, projects, ITPs, inspections, NCRs, observations, vault, reports, standalone, notifications, guide, plus handover and staff pages where the role may see them) with no error text, no 4xx/5xx and no bounce to sign-in |
| `04-walk.spec.ts` | Per role, a walk **project -> ITP -> checklist -> inspection -> NCR -> vault -> handover**. Targets are discovered from links the role can see (preferring the Meridian demo project `MER-2026-001`). A stage with nothing to open for a role is reported **skipped**, not passed |

Note on `/staff-access`: there is no such route. The page is `/inspect/organisation/staff-access`;
the suite asserts the real path is admin-only and that the bare `/staff-access` is a 404 for everyone.

"No error text" means none of: `Something went wrong`, `Application error`, `Internal Server Error`,
`Page not found`, `This page could not be found`, `could not load this page`, `Error ID:` (see
`ERROR_TEXT` in `helpers/auth.ts`).

## Write specs (`05-*`): gated, off by default

These specs exercise the write paths the read-only suite cannot: they submit the real forms. Because there is
**no staging database** (the only Supabase project is the real one), they are built so that nothing can write
by accident and everything they write can be found and removed.

| Spec | What it does (as the JAGS Admin, in the `E2E-` fixture only) |
|---|---|
| `05-00-write-setup.spec.ts` | Seeds the fixture: an `E2E-<run tag> Org`, two projects (`...-P1` active for the work, `...-P2` completed for the handover), an approved ITP with one activity and a one-question checklist in each, and a location preset. Seeding uses the service role on purpose (a clean, correctly named fixture is its job, not re-testing the create-project form). Saves ids to `e2e/.state/write-run.json` (git-ignored). |
| `05-01-ncr.spec.ts` | Raise an NCR -> start progress -> CAPA text + verification notes -> photo evidence -> send for verification -> verify and close. Reads the row back: `closed`, closer stamped. |
| `05-02-punch.spec.ts` | Add a punch item, then resolve it with written evidence and a photo. Reads back `resolved`. |
| `05-03-inspection.spec.ts` | Start an inspection on the approved checklist (location preset), answer, state "no evidence applies" with a reason, sign on the canvas, complete. Reads back `pass`, signer stamped. Saves the record id. |
| `05-04-irn.spec.ts` | Issue the IRN for that passed inspection. Reads back a live IRN with issuer stamped. Skipped if 05-03 has not produced a record. |
| `05-05-databook.spec.ts` | On the handover project: create a Data Book, compile it (ticking the Admin override only if the page offers one), upload a package and issue it for handover. Reads back `issued` and the certificate. |
| `05-06-handover-ack.spec.ts` | In the Handover Portal, acknowledge that certificate **on the client's behalf** (the demo client has no grant on the throwaway project; the client's own button and reject are not covered). |

### Safety flags and rules

| Variable | Meaning |
|---|---|
| `E2E_ALLOW_WRITES=1` | **Required.** Anything else and every `05-*` test is reported *skipped* and the browser is never launched for them. |
| `E2E_SUPABASE_URL`, `E2E_SUPABASE_SERVICE_ROLE_KEY` | **Required for the write specs.** The Supabase project behind `BASE_URL`. Used only to seed the `E2E-` fixture and to read back what the UI wrote. There is deliberately no fallback to the app's own env, so the project is chosen on purpose. |
| `E2E_RUN_TAG` | Optional (`E2E-...`). Default is generated once per run as `E2E-<yymmddhhmm><4 random>`. |
| `E2E_CLEANUP_CONFIRM=1` | Required for the cleanup script to **delete** (otherwise it is a dry run). |
| `E2E_CLEANUP_STORAGE=1` | Cleanup also removes the uploaded files of the removed projects (see below). |
| `E2E_CLEANUP_MAX` | Cleanup refuses to delete more than this many projects at once (default 20). |

Rules the specs follow, and a reviewer should keep:

1. Every record carries the run tag (`E2E-...`) in its name; every spec calls `expectE2eContext` before submitting, so a
   mis-resolved link can never write to a demo project.
2. The specs act only as the Admin through the UI, and only on ids from the fixture file. They never use a demo project.
3. They never delete anything. Removal is the cleanup script's job.
4. They are never run by CI: the `e2e` job does not set `E2E_ALLOW_WRITES`.

```bash
export E2E_ALLOW_WRITES=1
export E2E_SUPABASE_URL=https://<project>.supabase.co
export E2E_SUPABASE_SERVICE_ROLE_KEY=<service role key>
pnpm --filter @jags/web e2e -- tests/05-          # the write specs, in file order
pnpm --filter @jags/web e2e:cleanup               # DRY RUN: lists what would be removed
E2E_CLEANUP_CONFIRM=1 pnpm --filter @jags/web e2e:cleanup   # removes it
```

### Cleanup script (`e2e/scripts/cleanup-e2e-data.mjs`)

Removes **only** organisations and projects whose names start with `E2E-` (rules in `cleanup-select.mjs`, covered by
`lib/e2e/__tests__/cleanup-plan.test.ts`). A project is removable only if its name *and* number start with `E2E-` *and*
its organisation is an `E2E-` organisation; an organisation is removable only if every project in it is. Everything under a
removed project (NCRs, punch items, inspections, IRNs, Data Books, certificates, ...) goes with it through the database's
cascades. A project named `E2E-...` under a real client organisation, or an `E2E-` organisation that also holds a real
project, is **left alone and reported**. `E2E_RUN_TAG=E2E-...` limits it to one run.

It is a **dry run by default** (it prints the organisations, projects, row counts and anything it is leaving alone) and
deletes only with `E2E_CLEANUP_CONFIRM=1`. Uploaded files are untouched unless `E2E_CLEANUP_STORAGE=1`, which removes
`inspection-evidence/<E2E project id>/**` and `generated-documents/handover/<E2E data book id>/**` for the removed projects
(other buckets, e.g. vault documents filed by hand, are not touched).

### Status of these specs

The write specs, the seed and the cleanup script were written against the app's forms (field `name`s and button labels in
`app/inspect/**`) and the database schema. They type-check (`pnpm --filter @jags/web typecheck`), are listed by
`playwright test --list`, and are reported *skipped* with the flag off. **They have not been executed against a deployment**
(none is safe to point them at from the environment they were written in), so expect to adjust selectors on the first real
run. The cleanup script's dry run and delete were exercised against a local Postgres 16 with the full migration chain
applied, through a test-only HTTP shim; its selection rules are unit-tested.

## Running

```bash
pnpm install
# Browser: CI installs one (`playwright install --with-deps chromium`). In a sandbox that already
# ships browsers, point at them instead and do NOT run `playwright install`:
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers     # uses $PLAYWRIGHT_BROWSERS_PATH/chromium

pnpm --filter @jags/web e2e                          # whole suite (the 05-* write specs are skipped)
pnpm --filter @jags/web e2e -- tests/02-access.spec.ts
pnpm --filter @jags/web e2e:report                   # Markdown summary of the last run
```

Output: `e2e/test-results/results.json` (machine readable), `e2e/playwright-report/` (HTML), traces and
screenshots for failures under `e2e/test-results/`. All three, and the cached sessions in `e2e/.auth/`,
are git-ignored.

## Configuration (environment)

| Variable | Default |
|---|---|
| `BASE_URL` | `https://jags-qmp-client-dev.vercel.app` |
| `E2E_PASSWORD` | `DemoPass123!` |
| `E2E_ADMIN_EMAIL` | `admin@jagsassurance.local` |
| `E2E_INSPECTOR_EMAIL` | `inspector@jagsassurance.local` |
| `E2E_INSPECTOR_SCOPED_EMAIL` | `inspector.scoped@jagsassurance.local` |
| `E2E_CLIENT_EMAIL` | `client@meridian.demo` |
| `E2E_SUBCONTRACTOR_EMAIL` | `subcontractor@voltway.demo` |
| `E2E_CONTRACTOR_EMAIL` | `contractor@gfl.demo` |
| `E2E_TPI_EMAIL` | `tpi@bureauveritas.demo` |
| `E2E_PROJECT_ID` | `c0000000-0000-0000-0000-000000000001` (project preferred by the walk) |
| `PLAYWRIGHT_BROWSERS_PATH` | unset; when set and it holds a `chromium` launcher, that binary is used |

Empty values fall back to the default, so unset CI secrets are harmless.

Sessions are cached per role in `e2e/.auth/<role>.json` for 20 minutes, so a full run performs about
one real sign-in per role. The suite uses one worker on purpose (shared dev site, sign-in throttle).

## CI

`.github/workflows/ci.yml` has an `e2e` job that runs only from **Actions -> CI -> Run workflow** with
`run_e2e` ticked. It never sets `E2E_ALLOW_WRITES`, so the `05-*` write specs are skipped there. It reads `E2E_BASE_URL`, `E2E_PASSWORD` and the `E2E_*_EMAIL` values from repository
secrets, writes the Markdown summary to the job summary and uploads the report as an artifact.

## When a test fails

A failure here is a finding about the deployed site (or about demo data), not noise: open the trace
(`npx playwright show-trace e2e/test-results/<test>/trace.zip`). Do not loosen an assertion to make
a run green; if the data a stage needs is missing for a role, the stage should be reported skipped.
The results of the last recorded run, failures included, are in `docs/E2E_RUN_RESULTS.md`.
