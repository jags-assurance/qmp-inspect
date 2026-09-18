// Real load test for JAGS Assurance QMP Inspect, covering the exact concern raised: "1000+ members,
// login takes time, check RBAC/tariff handling." Run this against a STAGING environment, never
// production, with synthetic test accounts (see seed-test-users.mjs in this directory).
//
// Why this hits Supabase's REST/Auth APIs directly instead of the Next.js pages: replicating the
// exact browser session-cookie format @supabase/ssr sets (base64, possibly chunked, version-
// dependent) can't be verified from a sandbox with no live environment to test against. Testing
// directly against Supabase Auth (GoTrue) and PostgREST instead exercises the SAME backend work a
// real page load does — auth validation, the users+access_grants lookup requireSession() makes, RLS
// evaluation on every table read/write — without the fragile, unverifiable cookie-replication step.
// This is a legitimate, honest way to load-test the actual bottleneck candidates (Auth service,
// Postgres/RLS, connection pooling) even though it doesn't render Next.js pages themselves.
//
// Run:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_ANON_KEY=eyJ... \
//   TEST_USERS_FILE=./test-users.json \
//   k6 run load-tests/k6-load-test.js
//
// Optional (enables the write-path scenario — skipped with a warning if unset, since it needs real
// data seeded in your staging project first):
//   TEST_INSPECTION_RECORD_ID=<uuid> TEST_CHECKLIST_ITEM_ID=<uuid>
//
// test-users.json (produced by seed-test-users.mjs): a JSON array of {"email":...,"password":...}.
// Needs at least as many entries as the peak VU count in the login-stampede scenario below, or k6
// will reuse credentials and you'll be testing session-reuse behavior, not distinct concurrent logins.

import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import encoding from "k6/encoding";
import { Trend, Rate } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const TEST_INSPECTION_RECORD_ID = __ENV.TEST_INSPECTION_RECORD_ID || "";
const TEST_CHECKLIST_ITEM_ID = __ENV.TEST_CHECKLIST_ITEM_ID || "";
const WRITE_SCENARIO_ENABLED = !!(TEST_INSPECTION_RECORD_ID && TEST_CHECKLIST_ITEM_ID);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required env vars.");
}
if (!WRITE_SCENARIO_ENABLED) {
  console.warn(
    "TEST_INSPECTION_RECORD_ID / TEST_CHECKLIST_ITEM_ID not set — the checklist-write scenario will be " +
      "skipped (reads only). Seed a real draft inspection_records row + checklist_items row in staging " +
      "and pass their ids to exercise the write path."
  );
}

const testUsers = new SharedArray("test users", () => {
  const raw = open(__ENV.TEST_USERS_FILE || "./test-users.json");
  return JSON.parse(raw);
});

// Custom metrics so the summary directly answers "does login take too long at scale" and "does the
// dashboard's real read query hold up", not just an aggregate across every request of every kind.
const loginDuration = new Trend("custom_login_duration", true);
const loginFailureRate = new Rate("custom_login_failures");
const sessionReadDuration = new Trend("custom_session_read_duration", true);
const checklistWriteDuration = new Trend("custom_checklist_write_duration", true);

export const options = {
  scenarios: {
    // Scenario A: a "login stampede" — many distinct users signing in within a short window (the
    // literal shift-start scenario). One iteration per VU: sign in once, hold a moment, done. This
    // isolates Auth-service (GoTrue) capacity from steady-state app load.
    login_stampede: {
      executor: "ramping-vus",
      exec: "loginStampede",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 200 },
        { duration: "30s", target: 1000 },
        { duration: "1m", target: 1000 },
        { duration: "30s", target: 0 },
      ],
    },
    // Scenario B: steady-state authenticated load — each VU logs in once, then repeatedly performs
    // the real read (requireSession's own two queries: users by id, access_grants by user_id — the
    // exact query pair that was previously sequential/duplicated and got fixed) and, if configured, a
    // real write (a checklist_responses upsert, mirroring saveChecklistResponseAction). Starts after
    // the stampede has ramped up, layering "steady traffic while a new wave of logins also happens".
    steady_state: {
      executor: "ramping-vus",
      exec: "steadyState",
      startVUs: 0,
      startTime: "20s",
      stages: [
        { duration: "40s", target: 300 },
        { duration: "2m", target: 300 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    // These are the actual pass/fail bar — tune to your real SLA before trusting a green run.
    custom_login_duration: ["p(95)<2000"], // 95% of logins under 2s
    custom_login_failures: ["rate<0.01"], // under 1% failed logins
    custom_session_read_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.02"],
  },
};

function signIn(user) {
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: user.email, password: user.password }),
    { headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" } }
  );
  const ok = check(res, {
    "sign-in returned 200": (r) => r.status === 200,
    "sign-in returned access_token": (r) => !!r.json("access_token"),
  });
  loginFailureRate.add(!ok);
  return { ok, accessToken: ok ? res.json("access_token") : null };
}

// Minimal JWT payload decode — no signature verification needed, this is our own freshly-issued
// token from the sign-in call above, only used to read the `sub` claim (the user id) for the
// subsequent REST calls. k6's JS runtime has no Buffer/atob, hence k6/encoding.
function jwtSub(token) {
  const payload = token.split(".")[1];
  const decoded = encoding.b64decode(payload, "rawurl", "s");
  return JSON.parse(decoded).sub;
}

export function loginStampede() {
  const user = testUsers[__VU % testUsers.length];
  const start = Date.now();
  const { ok } = signIn(user);
  loginDuration.add(Date.now() - start);
  if (ok) sleep(Math.random() * 2 + 1); // a real user pauses on the dashboard briefly after login
}

export function steadyState() {
  const user = testUsers[__VU % testUsers.length];
  const { ok, accessToken } = signIn(user);
  if (!ok) return;

  const userId = jwtSub(accessToken);
  const authHeaders = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  for (let i = 0; i < 5; i++) {
    const readStart = Date.now();
    const responses = http.batch([
      [
        "GET",
        `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=id,email,full_name,is_jags_staff,staff_role`,
        null,
        { headers: authHeaders },
      ],
      [
        "GET",
        `${SUPABASE_URL}/rest/v1/access_grants?user_id=eq.${userId}&select=scope_type,organization_id,project_id,role`,
        null,
        { headers: authHeaders },
      ],
    ]);
    sessionReadDuration.add(Date.now() - readStart);
    check(responses[0], { "session read: users ok": (r) => r.status === 200 });
    check(responses[1], { "session read: access_grants ok": (r) => r.status === 200 });

    if (WRITE_SCENARIO_ENABLED) {
      const writeStart = Date.now();
      const writeRes = http.post(
        `${SUPABASE_URL}/rest/v1/checklist_responses?on_conflict=inspection_record_id,checklist_item_id`,
        JSON.stringify({
          inspection_record_id: TEST_INSPECTION_RECORD_ID,
          checklist_item_id: TEST_CHECKLIST_ITEM_ID,
          result: ["yes", "no", "na"][Math.floor(Math.random() * 3)],
          comment: `k6 load test @ ${new Date().toISOString()}`,
        }),
        { headers: { ...authHeaders, Prefer: "resolution=merge-duplicates" } }
      );
      checklistWriteDuration.add(Date.now() - writeStart);
      check(writeRes, { "checklist write ok": (r) => r.status === 200 || r.status === 201 });
    }

    sleep(1 + Math.random() * 2);
  }
}
