# UAT checklist: verification run (2026-10-08, dev site)

Run against https://jags-qmp-client-dev.vercel.app with real logins for all six roles, plus code and build checks.
The Railway worker and the database migrations are NOT deployed/applied yet, so anything that depends on them is listed as blocked.

## Fixed during this run (all pushed to `dev`)
| Problem found | Fix |
|---|---|
| **Whole app down** (every signed-in page showed "Something went wrong") | `SiteLinks` and `ItpChecklistPreview` called a client hook from server components; marked as client components |
| **Project list down** | Server page called `isClosedStatus` imported from a client file; moved to the plain `close-helpers` module |
| Both bugs pass type-check and unit tests | New test `lib/__tests__/client-boundary.test.ts` fails if a server file calls a client-only function or hook (verified it catches both original bugs) |
| A11: auth cookie not `Secure` | Shared cookie options: `Secure` in production, `SameSite=Lax` (cannot be HttpOnly: the browser client needs it for uploads/realtime) |
| C6: hub "Open NCRs 3" but NCR list showed 0 (observations were counted as NCRs) | Card counts NCRs only; observations shown on their own line |
| R1: checklist page ran ~20 queries one after another | Independent queries now run in parallel (not enough on its own, see Open below) |

## PASS (verified)
A1 sign in as all six roles (admin lands /platform, others /inspect, no error screens) · A5 short and common passwords refused with clear messages · A11 no service-role key or JWT in any JS bundle (73 bundles), auth cookie now Secure · C6 hub counts match lists · D10 Excel and Word exports are valid files · H2 signature pad registers touch drawing at phone size · M1 three role dashboards show their own content, links open · M2 client KPI tiles open their lists · M11 guide opens (accuracy needs a human read) · N1 manifest, 5 icons and service worker all load (real "Add to Home Screen" still needs a phone) · N2 offline banner shows and visited pages open offline · S1 no sideways scroll at 375/768/1280 on 12 key pages · S4 axe finds 0 contrast violations on 5 key pages · T6 (local) lint 0 errors, typecheck, 1176 web + worker tests, production build and migration-name check all pass.

## FAIL or OPEN: needs a fix or a decision
| Item | Status | What is needed |
|---|---|---|
| T6 CI is green | **FAIL (GitHub side)** | Every CI job on every recent push fails within ~3 seconds with no log (HTTP 404). That pattern means GitHub is not starting the jobs, usually an Actions billing or spending-limit problem, or Actions disabled. Check GitHub > Settings > Billing and the repo's Actions settings. The same steps pass locally. |
| R1/R2 speed | **OPEN** | Lists respond in 1.3-2 s and the dashboard in 2-5 s. The checklist page still takes 10-17 s server time on the demo projects. Cause not isolated without server logs: open the Vercel function logs or Supabase query performance for `/inspect/checklists/[id]`, likely a query that is slow on the demo data or has no index because the 2026-11 index migrations are not applied. |
| T8, T15, U4, U6, U7 | **FAIL (owner content)** | The documents and pages exist, but contain `[OWNER TO FILL]` placeholders: incident contacts, rollback rehearsal log, retention periods, data-request owner and timelines, real legal wording. Only you can supply them. |
| V1, V2 | blocked | Depend on the rows above and on the items below. |
| A5 (leaked-password) , A6 | needs you | Supabase Auth setting (leaked-password protection) and a real reset email to a real mailbox. |

## BLOCKED until the Railway worker is redeployed
B2 branding on PDFs, K9 PDF layout on every PDF (incl. Arabic), K17 email transmittal, L5 large-project PDF, R3 PDF timing, O3 email outbox, M5 notification email, T2 worker healthy, D10 PDF export.

## NEEDS YOU (dashboards, devices, people)
Q1 backups on, Q2 restore test, Q3 storage export scheduled, Q4 migrations applied (nothing from 2026-11 is applied yet; see docs/fixes/REMAINING.md), Q5 RLS suite on dev, Q6 advisors, Q7 indexes after a load test, Q8 test-data decision, Q10 written retention policy · T1 env vars, T4 Sentry DSN, T5 uptime monitor on /api/health, T7 staging, T9 email SPF/DKIM/DMARC, T10 domain and certificate, T11 bucket limits, T13 key rotation, T14 production access and MFA · U1 guide walk-through, U2 follow the runbook, U3 role training · V3 client acceptance, V4 cleanup decision, V5 cutover plan, V6 support rota · N1 phone install, N11 update prompt, R4 load test (k6), R5 4G on a phone, R6 worker backlog, R7 DB load, R8 large photos on a device · O6 prompt-injection check on a live AI run · S13 wording read, S14 client branding (this org is JAGS-led, so JAGS branding is correct by design).
