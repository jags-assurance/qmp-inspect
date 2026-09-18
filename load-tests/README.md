# Load testing — JAGS Assurance QMP Inspect

Answers the real, unverified question from the CEO's requirements review: can this handle 1000+
concurrent members, and does login/RBAC/tariff handling hold up under that load? This was
explicitly flagged as unverifiable from a sandboxed session with no live environment access — these
scripts are what you (or your team / a QA vendor) run against a real **staging** environment to get
an actual answer.

**Never run this against production.** It creates real load and real synthetic accounts.

## What's here

- `k6-load-test.js` — the actual load test (see its own header comment for full design rationale:
  why it hits Supabase's Auth/REST APIs directly instead of the Next.js pages, what each scenario
  measures, and the thresholds that make it pass/fail rather than just a report).
- `seed-test-users.mjs` — creates N synthetic Supabase Auth accounts (+ matching `users` /
  `access_grants` rows) so the login-stampede scenario tests distinct concurrent logins instead of
  hammering one account, which would just trip Supabase's own Auth rate limiter and give a
  meaningless result.

## Prerequisites

1. A staging Supabase project with the app's schema (all migrations applied) — including the ones
   from this session that are still sitting unapplied (see `supabase/MIGRATIONS.md`).
2. [k6](https://k6.io/docs/get-started/installation/) installed wherever you'll run the test from.
3. Node.js, for the seed script.

## Steps

```bash
cd load-tests
npm install   # standalone tool, deliberately outside the pnpm workspace — see package.json

# 1. Create test accounts (takes a while at four-figure counts — Supabase Auth's own admin API has
#    its own rate limit, so this paces itself; expect ~1000 users to take several minutes)
SUPABASE_URL=https://your-staging-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
node seed-test-users.mjs 1000

# 2. (Optional, enables the write-path scenario) Seed one real draft inspection + checklist item in
#    staging by hand, and note their ids.

# 3. Run the load test
SUPABASE_URL=https://your-staging-project.supabase.co \
SUPABASE_ANON_KEY=eyJ... \
TEST_USERS_FILE=./test-users.json \
TEST_INSPECTION_RECORD_ID=<uuid, optional> \
TEST_CHECKLIST_ITEM_ID=<uuid, optional> \
k6 run k6-load-test.js
```

## Reading the results

k6 prints a summary at the end. The numbers that actually answer the CEO's question:

- `custom_login_duration` (p95) — how slow login gets as concurrent logins ramp toward 1000. This is
  the literal "login takes time at scale" concern.
- `custom_login_failures` — rate of failed logins under load (timeouts, 5xx, rate-limiting).
- `custom_session_read_duration` (p95) — the exact query pair `requireSession()` runs on every page
  load, under concurrent load. If this degrades, every page in the app degrades with it.
- `custom_checklist_write_duration` (p95) — a real write path under RLS, if you configured the
  optional write scenario.
- `http_req_failed` — overall error rate across everything.

The `thresholds` block in `k6-load-test.js` encodes a starting SLA (p95 login < 2s, p95 session read
< 500ms, <1% login failures, <2% overall failures) — k6 exits non-zero if any threshold is breached,
so this is wireable into CI as a real pass/fail gate once you're comfortable with the numbers.

## Afterward

- Delete the synthetic test accounts from staging (`seed-test-users.mjs` doesn't clean up after
  itself — this is deliberate, so you can re-run the load test without re-seeding every time; delete
  them once you're done via the Supabase dashboard's Auth users list, filtering by
  `k6-loadtest-*@example.invalid`).
- If a bottleneck shows up: check Supabase's own dashboard (Database → Performance) for slow-query
  reports and connection-pool saturation during the exact time window of the test run — that'll tell
  you whether it's Postgres, the connection pooler, or the Auth service specifically.
