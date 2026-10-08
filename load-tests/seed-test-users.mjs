#!/usr/bin/env node
// One-time helper: creates N synthetic Supabase Auth users in your STAGING project for the k6
// login-stampede scenario, plus a matching `users` row (is_jags_staff + a global access_grants row)
// so they can actually read/write through RLS the same way a real inspector could.
//
// Needs the SERVICE ROLE key (bypasses RLS/Auth admin restrictions) — never run this against
// production, never commit the service role key, never reuse it in the k6 script itself (that only
// ever uses the public anon key + a real user session, exactly like the real app does).
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node load-tests/seed-test-users.mjs 1000
//
// Writes load-tests/test-users.json — gitignored, contains real (synthetic) passwords.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COUNT = Number.parseInt(process.argv[2] ?? "1000", 10);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
// This repository has no staging project, so a pasted production URL is the realistic failure. Same speed bump
// as the k6 script: the target must be named a second time, exactly.
if ((process.env.LOAD_TEST_CONFIRM_TARGET ?? "").trim() !== SUPABASE_URL.trim()) {
  console.error(`Refusing to seed: set LOAD_TEST_CONFIRM_TARGET to exactly ${SUPABASE_URL}. It must be a dedicated test project, never the real one.`);
  process.exit(1);
}
if (!Number.isFinite(COUNT) || COUNT <= 0) {
  console.error("Pass the number of test users to create as the first argument, e.g. `node seed-test-users.mjs 1000`.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const users = [];
  console.log(`Creating ${COUNT} synthetic test users — this can take a while at four-figure counts.`);

  for (let i = 0; i < COUNT; i++) {
    const email = `k6-loadtest-${i}@example.invalid`;
    const password = `Loadtest-${i}-${Math.random().toString(36).slice(2, 10)}!`;

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      // Already exists from a previous run — fine, just reuse it, but we don't know its password
      // in that case, so skip it rather than guess.
      if (createError.message?.includes("already been registered")) {
        console.warn(`Skipping ${email} — already exists from a previous run.`);
        continue;
      }
      console.error(`Failed to create ${email}:`, createError.message);
      continue;
    }

    const userId = created.user.id;

    // Minimal profile row + a global access grant (Inspector-equivalent) so RLS treats this account
    // like a real, org-wide JAGS staff login — matches how a real seeded/admin-created account works.
    const { error: profileError } = await supabase.from("users").upsert({
      id: userId,
      email,
      full_name: `Load Test User ${i}`,
      is_jags_staff: true,
      staff_role: "inspector",
    });
    if (profileError) console.error(`Failed to upsert users row for ${email}:`, profileError.message);

    const { error: grantError } = await supabase.from("access_grants").insert({
      user_id: userId,
      scope_type: "global",
      organization_id: null,
      project_id: null,
      role: "inspector",
    });
    if (grantError) console.error(`Failed to insert access_grants row for ${email}:`, grantError.message);

    users.push({ email, password });
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${COUNT} created…`);
  }

  writeFileSync(new URL("./test-users.json", import.meta.url), JSON.stringify(users, null, 2));
  console.log(`Done — wrote ${users.length} test users to load-tests/test-users.json.`);
  console.log("Remember to delete these accounts from staging when you're done load testing.");
}

main();
