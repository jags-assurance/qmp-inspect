# QMP end-to-end suite (read-only)

Playwright tests that drive the **deployed** web app in a real browser. They sign in with the seeded
demo accounts and only navigate and read. The sign-in form is the only form ever submitted; no
server action is called, and every spec asserts that no write request (a `Next-Action` POST or a
non-GET `/api/*` call) was made.

Sign-in itself leaves the usual footprint (an auth session and one `sign_in` audit event per login).
Nothing else changes.

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

## Running

```bash
pnpm install
# Browser: CI installs one (`playwright install --with-deps chromium`). In a sandbox that already
# ships browsers, point at them instead and do NOT run `playwright install`:
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers     # uses $PLAYWRIGHT_BROWSERS_PATH/chromium

pnpm --filter @jags/web e2e                          # whole suite
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
`run_e2e` ticked. It reads `E2E_BASE_URL`, `E2E_PASSWORD` and the `E2E_*_EMAIL` values from repository
secrets, writes the Markdown summary to the job summary and uploads the report as an artifact.

## When a test fails

A failure here is a finding about the deployed site (or about demo data), not noise: open the trace
(`npx playwright show-trace e2e/test-results/<test>/trace.zip`). Do not loosen an assertion to make
a run green; if the data a stage needs is missing for a role, the stage should be reported skipped.
The results of the last recorded run, failures included, are in `docs/E2E_RUN_RESULTS.md`.
