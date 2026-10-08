# Load testing — JAGS Assurance QMP Inspect

Answers the real, unverified question from the CEO's requirements review: can this handle 1000+
concurrent members, and does login/RBAC/tariff handling hold up under that load? This was
explicitly flagged as unverifiable from a sandboxed session with no live environment access — these
scripts are what you (or your team / a QA vendor) run against a **dedicated test Supabase project**
to get an actual answer. **No result has been recorded yet**: `BASELINES.md` is the empty template.

> **There is no staging database.** The only Supabase project this repository points at is the real
> one. Never run the seed script or k6 against it: 1000 concurrent synthetic logins is an outage, and
> the seed script creates real accounts. Create a throwaway Supabase project (or a branch) for the
> test, apply every migration to it, and delete it afterwards. Both scripts refuse to run unless
> `LOAD_TEST_CONFIRM_TARGET` is set to exactly the `SUPABASE_URL` they will hit, so the target has to
> be typed twice.

## What's here

- `k6-load-test.js` — the actual load test (see its own header comment for full design rationale:
  why it hits Supabase's Auth/REST APIs directly instead of the Next.js pages, what each scenario
  measures, and the thresholds that make it pass/fail rather than just a report).
- `seed-test-users.mjs` — creates N synthetic Supabase Auth accounts (+ matching `users` /
  `access_grants` rows) so the login-stampede scenario tests distinct concurrent logins instead of
  hammering one account, which would just trip Supabase's own Auth rate limiter and give a
  meaningless result.
- `BASELINES.md` — where results are recorded (template to fill, thresholds explained, and the list
  queries most likely to be slow with the indexes already added or suggested).

## Prerequisites

1. A dedicated test Supabase project with the app's schema (**all** migrations applied, including the
   newest, `20261124000100_list_query_indexes.sql`; see `supabase/MIGRATIONS.md`). Not the real project.
2. [k6](https://k6.io/docs/get-started/installation/) installed wherever you'll run the test from.
3. Node.js, for the seed script.
4. For a result that means something: the test project on the **same plan / compute size** as the real
   one, seeded with a realistic data volume (otherwise you are measuring an empty database).

## Steps

```bash
cd load-tests
npm install   # standalone tool, deliberately outside the pnpm workspace — see package.json

# 1. Create test accounts (takes a while at four-figure counts — Supabase Auth's own admin API has
#    its own rate limit, so this paces itself; expect ~1000 users to take several minutes)
SUPABASE_URL=https://your-test-project.supabase.co \
LOAD_TEST_CONFIRM_TARGET=https://your-test-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
node seed-test-users.mjs 1000

# 2. (Optional, enables the write-path scenario) Seed one real draft inspection + checklist item in
#    the test project by hand, and note their ids.

# 3. Run the load test (three runs, then record the median in BASELINES.md)
mkdir -p results
SUPABASE_URL=https://your-test-project.supabase.co \
LOAD_TEST_CONFIRM_TARGET=https://your-test-project.supabase.co \
SUPABASE_ANON_KEY=eyJ... \
TEST_USERS_FILE=./test-users.json \
TEST_INSPECTION_RECORD_ID=<uuid, optional> \
TEST_CHECKLIST_ITEM_ID=<uuid, optional> \
k6 run --summary-export=results/$(date +%F)-<env>.json k6-load-test.js
```

## Reading the results

k6 prints a summary at the end (the script asks for avg, min, med, p(90), p(95), p(99) and max for
every trend, so the p50 / p95 / p99 that `BASELINES.md` records are all in it). The numbers that
actually answer the CEO's question:

- `custom_login_duration` — how slow login gets as concurrent logins ramp toward 1000. This is
  the literal "login takes time at scale" concern.
- `custom_login_failures` — rate of failed logins under load (timeouts, 5xx, rate-limiting).
- `custom_session_read_duration` — the exact query pair `requireSession()` runs on every page
  load, under concurrent load. If this degrades, every page in the app degrades with it.
- `custom_checklist_write_duration` — a real write path under RLS, if you configured the
  optional write scenario.
- `http_req_failed` — overall error rate across everything.

### Thresholds (pass / fail)

The `thresholds` block in `k6-load-test.js` encodes a starting SLA. k6 exits non-zero if any is
breached, so this is wireable into CI as a real pass/fail gate once you trust the numbers.

| Threshold | Bar | Why |
|---|---|---|
| `custom_login_duration` | p(95) < 2000 ms | a shift-start login should not feel stuck |
| `custom_login_failures` | rate < 1% | timeouts, 5xx and Auth rate limiting all count |
| `custom_session_read_duration` | p(95) < 500 ms | every page pays this on every load |
| `http_req_failed` | rate < 2% | all requests of all kinds |

These are **starting values, not measured limits**. There is deliberately no threshold on
`custom_checklist_write_duration` yet: set one only after a baseline exists. Once `BASELINES.md` has
three recorded runs, tighten the bars to the recorded p95 plus a margin (for example +25%) so a
regression fails the run instead of passing under a loose absolute number.

### Recording a baseline

Copy the numbers from the summary (or from `results/*.json`) into the table in `BASELINES.md`:
scenario, p50 / p95 / p99, error rate, date, environment (project plan and compute size, data volume,
k6 version, git commit of the app and the last migration applied). Record the median of three runs,
not the best one. A baseline without its environment row is not comparable and should not be trusted.

## Afterward

- Delete the synthetic test accounts (`seed-test-users.mjs` doesn't clean up after
  itself — this is deliberate, so you can re-run the load test without re-seeding every time; delete
  them once you're done via the Supabase dashboard's Auth users list, filtering by
  `k6-loadtest-*@example.invalid`), or simply delete the whole throwaway project.
- If a bottleneck shows up: check Supabase's own dashboard (Database → Performance) for slow-query
  reports and connection-pool saturation during the exact time window of the test run — that'll tell
  you whether it's Postgres, the connection pooler, or the Auth service specifically. Then check
  `BASELINES.md` ("Likely slow list queries") for known suspects.
