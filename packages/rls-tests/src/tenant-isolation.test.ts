/**
 * Automated tenant-isolation regression suite (round-table "do now" recommendation — CEO, CTO, and
 * Compliance all independently flagged that the RLS scoping bugs fixed this cycle were caught by
 * manual review, not by any automated guardrail, and that the same class of mistake could ship
 * again unnoticed). This runs against a REAL Supabase project (this app has no local Postgres/
 * Docker stack — see supabase/config.toml's own header comment), using two disposable, clearly-
 * marked fixture organizations/projects/users created via the Supabase Admin API and torn down in a
 * `finally` block regardless of outcome — never touching real seeded data.
 *
 * What this proves: a user scoped to org A's project cannot read org B's rows on any table this
 * session's fixes touched (projects, itps, ncrs, standalone_assignments, handover_certificates,
 * background_jobs), cannot download org B's files from either Storage bucket, and cannot query the
 * vw_powerbi_* analytics views at all (the REVOKE fix from 20260916140000 — regressing that specific
 * grant back to `authenticated` is exactly the mistake that would slip past typecheck/build silently,
 * which is why it gets its own named check here).
 *
 * Run: `pnpm test` from this package, or `pnpm -r --if-present test` from the repo root.
 * Requires SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_ANON_KEY (or
 * NEXT_PUBLIC_SUPABASE_ANON_KEY), and SUPABASE_SERVICE_ROLE_KEY in the environment — see
 * apps/web/.env.local for the same three values already used by the Next.js app.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// Reuse apps/web's own .env.local rather than requiring a separate copy of the same three secrets.
loadEnv({ path: path.resolve(__dirname, "../../../apps/web/.env.local") });

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error(
    "[rls-tests] Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY (or their NEXT_PUBLIC_ equivalents) in the environment."
  );
  process.exit(1);
}

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MARK = `__rls_test_${RUN_ID}__`; // unique, greppable marker so fixture rows are never mistaken for real data

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface Failure {
  check: string;
  detail: string;
}
const failures: Failure[] = [];

function check(name: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.error(`  FAIL ${name} — ${detail}`);
    failures.push({ check: name, detail });
  }
}

interface Fixture {
  orgId: string;
  projectId: string;
  itpId: string;
  ncrId: string;
  assignmentId: string;
  dataBookId: string;
  certificateId: string;
  userId: string;
  email: string;
  password: string;
  vaultPath: string;
  handoverPath: string;
}

async function createFixture(label: "a" | "b"): Promise<Fixture> {
  const password = `RlsTest!${RUN_ID}`;
  const email = `rls-test-${label}-${RUN_ID}@rls-tests.invalid`;

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `${MARK} Org ${label.toUpperCase()}`, slug: `${MARK}-org-${label}` })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`org ${label}: ${orgErr?.message}`);

  const { data: project, error: projErr } = await admin
    .from("projects")
    .insert({
      organization_id: org.id,
      project_number: `${MARK}-PRJ-${label}`,
      name: `${MARK} Project ${label.toUpperCase()}`,
    })
    .select("id")
    .single();
  if (projErr || !project) throw new Error(`project ${label}: ${projErr?.message}`);

  const { data: itp, error: itpErr } = await admin
    .from("itps")
    .insert({ project_id: project.id, itp_number: `${MARK}-ITP-${label}`, title: `${MARK} ITP ${label}` })
    .select("id")
    .single();
  if (itpErr || !itp) throw new Error(`itp ${label}: ${itpErr?.message}`);

  const { data: ncr, error: ncrErr } = await admin
    .from("ncrs")
    .insert({
      project_id: project.id,
      ncr_number: `${MARK}-NCR-${label}`,
      severity: "minor_ncr",
      description: `${MARK} fixture NCR`,
    })
    .select("id")
    .single();
  if (ncrErr || !ncr) throw new Error(`ncr ${label}: ${ncrErr?.message}`);

  const { data: assignment, error: assignmentErr } = await admin
    .from("standalone_assignments")
    .insert({
      project_id: project.id,
      assignment_number: `${MARK}-SA-${label}`,
      assignment_type: "witness_inspection",
      equipment_description: `${MARK} fixture equipment`,
    })
    .select("id")
    .single();
  if (assignmentErr || !assignment) throw new Error(`assignment ${label}: ${assignmentErr?.message}`);

  const { data: dataBook, error: dataBookErr } = await admin
    .from("data_books")
    .insert({ project_id: project.id, book_number: `${MARK}-DB-${label}`, title: `${MARK} fixture data book` })
    .select("id")
    .single();
  if (dataBookErr || !dataBook) throw new Error(`data_book ${label}: ${dataBookErr?.message}`);

  const handoverPath = `handover/${dataBook.id}/${MARK}-package.pdf`;
  const { error: handoverUploadErr } = await admin.storage
    .from("generated-documents")
    .upload(handoverPath, Buffer.from(`${MARK} fixture handover package`), { contentType: "application/pdf" });
  if (handoverUploadErr) throw new Error(`handover upload ${label}: ${handoverUploadErr.message}`);

  const { data: certificate, error: certErr } = await admin
    .from("handover_certificates")
    .insert({
      data_book_id: dataBook.id,
      certificate_number: `${MARK}-HC-${label}`,
      package_storage_path: handoverPath,
      package_sha256: "0".repeat(64),
    })
    .select("id")
    .single();
  if (certErr || !certificate) throw new Error(`certificate ${label}: ${certErr?.message}`);

  const vaultPath = `vault/${project.id}/${MARK}-evidence.txt`;
  const { error: vaultUploadErr } = await admin.storage
    .from("inspection-evidence")
    .upload(vaultPath, Buffer.from(`${MARK} fixture evidence file`), { contentType: "text/plain" });
  if (vaultUploadErr) throw new Error(`vault upload ${label}: ${vaultUploadErr.message}`);

  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `${MARK} User ${label.toUpperCase()}` },
  });
  if (authErr || !authUser.user) throw new Error(`auth user ${label}: ${authErr?.message}`);

  // Project-scoped grant, matching a real subcontractor/client login — never 'global' or
  // 'organization', which would trivially (and correctly) see more than one project.
  const { error: grantErr } = await admin
    .from("access_grants")
    .insert({ user_id: authUser.user.id, scope_type: "project", organization_id: org.id, project_id: project.id, role: "client" });
  if (grantErr) throw new Error(`access_grant ${label}: ${grantErr.message}`);

  return {
    orgId: org.id,
    projectId: project.id,
    itpId: itp.id,
    ncrId: ncr.id,
    assignmentId: assignment.id,
    dataBookId: dataBook.id,
    certificateId: certificate.id,
    userId: authUser.user.id,
    email,
    password,
    vaultPath,
    handoverPath,
  };
}

async function queueCrossOrgJob(fixtureB: Fixture): Promise<string> {
  // Queued as service role, payload pointing at org B's ITP, 'requested_by' set to org B's own user
  // — so if org A's user can see it, that's ONLY explainable by the has_project_access branch
  // incorrectly matching, not the 'own job' self-visibility branch.
  const { data, error } = await admin
    .from("background_jobs")
    .insert({
      job_type: "render_itp_pdf",
      payload: { itp_id: fixtureB.itpId, requested_by: fixtureB.userId },
      status: "completed", // never actually processed by the worker; only existence/visibility matters
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`background_job fixture: ${error?.message}`);
  return data.id;
}

async function cleanup(fixture: Fixture, jobId: string | null) {
  if (jobId) await admin.from("background_jobs").delete().eq("id", jobId);
  await admin.from("handover_certificates").delete().eq("id", fixture.certificateId);
  await admin.storage.from("generated-documents").remove([fixture.handoverPath]);
  await admin.from("data_books").delete().eq("id", fixture.dataBookId);
  await admin.from("standalone_assignments").delete().eq("id", fixture.assignmentId);
  await admin.from("ncrs").delete().eq("id", fixture.ncrId);
  await admin.from("itps").delete().eq("id", fixture.itpId);
  await admin.storage.from("inspection-evidence").remove([fixture.vaultPath]);
  await admin.from("access_grants").delete().eq("user_id", fixture.userId);
  // projects_create_default_vault_folders auto-creates vault_folders rows on project insert (see
  // this session's own earlier-discovered lesson about this trigger) — those FK-reference the
  // project and must be cleared before the project row can be deleted.
  await admin.from("vault_folders").delete().eq("project_id", fixture.projectId);
  await admin.from("projects").delete().eq("id", fixture.projectId);
  await admin.from("organizations").delete().eq("id", fixture.orgId);
  await admin.auth.admin.deleteUser(fixture.userId);
}

async function main() {
  console.log(`[rls-tests] run ${RUN_ID} — creating disposable fixture orgs A and B...`);
  const fixtureA = await createFixture("a");
  const fixtureB = await createFixture("b");
  const crossOrgJobId = await queueCrossOrgJob(fixtureB);

  try {
    const userAClient = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInErr } = await userAClient.auth.signInWithPassword({
      email: fixtureA.email,
      password: fixtureA.password,
    });
    if (signInErr) throw new Error(`sign-in as user A failed: ${signInErr.message}`);

    console.log("[rls-tests] signed in as org A's project-scoped user; probing org B's data...");

    // --- Positive control: user A must still be able to read their OWN project's own ITP ---
    const { data: ownItp } = await userAClient.from("itps").select("id").eq("id", fixtureA.itpId).maybeSingle();
    check("positive-control: can read own project's ITP", !!ownItp, "own-project read failed — fixture/setup is broken, not a security finding");

    // --- Cross-tenant reads: every one of these must return zero rows ---
    const { data: crossProject } = await userAClient.from("projects").select("id").eq("id", fixtureB.projectId);
    check("projects: cannot read another org's project", (crossProject ?? []).length === 0, `got ${crossProject?.length ?? 0} row(s)`);

    const { data: crossItp } = await userAClient.from("itps").select("id").eq("id", fixtureB.itpId);
    check("itps: cannot read another org's ITP", (crossItp ?? []).length === 0, `got ${crossItp?.length ?? 0} row(s)`);

    const { data: crossNcr } = await userAClient.from("ncrs").select("id").eq("id", fixtureB.ncrId);
    check("ncrs: cannot read another org's NCR", (crossNcr ?? []).length === 0, `got ${crossNcr?.length ?? 0} row(s)`);

    const { data: crossAssignment } = await userAClient
      .from("standalone_assignments")
      .select("id")
      .eq("id", fixtureB.assignmentId);
    check(
      "standalone_assignments: cannot read another org's assignment",
      (crossAssignment ?? []).length === 0,
      `got ${crossAssignment?.length ?? 0} row(s)`
    );

    const { data: crossCert } = await userAClient.from("handover_certificates").select("id").eq("id", fixtureB.certificateId);
    check(
      "handover_certificates: cannot read another org's certificate",
      (crossCert ?? []).length === 0,
      `got ${crossCert?.length ?? 0} row(s)`
    );

    const { data: crossJob } = await userAClient.from("background_jobs").select("id").eq("id", crossOrgJobId);
    check("background_jobs: cannot read another org's render job", (crossJob ?? []).length === 0, `got ${crossJob?.length ?? 0} row(s)`);

    // --- Storage: cannot download another org's files from either bucket ---
    const { error: vaultDownloadErr } = await userAClient.storage.from("inspection-evidence").download(fixtureB.vaultPath);
    check(
      "storage(inspection-evidence): cannot download another org's evidence file",
      !!vaultDownloadErr,
      vaultDownloadErr ? "denied as expected" : "download SUCCEEDED — cross-tenant storage leak"
    );

    const { error: handoverDownloadErr } = await userAClient.storage.from("generated-documents").download(fixtureB.handoverPath);
    check(
      "storage(generated-documents): cannot download another org's handover package",
      !!handoverDownloadErr,
      handoverDownloadErr ? "denied as expected" : "download SUCCEEDED — cross-tenant storage leak"
    );

    // --- The specific regression this session found and reverted: vw_powerbi_* must reject
    // `authenticated` entirely, not just filter rows. Any ordinary logged-in user querying these at
    // all (not just cross-org) is the exact leak that was caught and fixed in 20260916140000. ---
    const { error: powerbiErr } = await userAClient.from("vw_powerbi_ncr_trends").select("*").limit(1);
    check(
      "vw_powerbi_ncr_trends: ordinary authenticated user is rejected outright (not just row-filtered)",
      !!powerbiErr,
      powerbiErr ? "denied as expected" : "query SUCCEEDED — the 20260916140000 REVOKE has regressed"
    );

    await userAClient.auth.signOut();
  } finally {
    console.log("[rls-tests] tearing down fixtures...");
    await cleanup(fixtureA, null).catch((e) => console.error("[rls-tests] cleanup A failed:", e));
    await cleanup(fixtureB, crossOrgJobId).catch((e) => console.error("[rls-tests] cleanup B failed:", e));
  }

  if (failures.length > 0) {
    console.error(`\n[rls-tests] ${failures.length} tenant-isolation check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f.check}: ${f.detail}`);
    process.exit(1);
  }

  console.log(`\n[rls-tests] all tenant-isolation checks passed.`);
}

main().catch((err) => {
  console.error("[rls-tests] unexpected error:", err);
  process.exit(1);
});
