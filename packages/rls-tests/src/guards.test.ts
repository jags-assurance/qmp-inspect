/**
 * Guard regression suite: the database-side controls added by the Phase 1 / Stage 1 hardening
 * migrations. Like tenant-isolation.test.ts this runs against a REAL Supabase project (there is no
 * local Postgres in this repo) using disposable, clearly-marked fixtures created with the service
 * role and torn down in a `finally` block. It signs in as ordinary fixture users (anon key + real
 * password session) so every probe goes through RLS exactly as a browser session would.
 *
 * Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (or the NEXT_PUBLIC_ forms),
 * from the environment or apps/web/.env.local. WITHOUT them it prints a message and exits 1; it is
 * wired into CI only where those secrets exist. `pnpm typecheck` in this package compiles it with
 * no environment at all.
 *
 * Run: `pnpm --filter @jags/rls-tests test:guards` (or `pnpm test`, which runs both suites).
 *
 * What each section proves, and the migration that introduced the guard:
 *
 *   1. users privilege lockdown          20261104000100_users_privilege_lockdown.sql
 *        - a signed-in user cannot flip is_jags_staff / staff_role / is_active / email /
 *          must_change_password on their own row (self-promotion hole), but can still edit full_name
 *        - only an Admin may delete a users row
 *        - a deactivated account, or one still on a temporary password, loses all project access
 *   2. access_grants scoping             20261104000200_access_grants_scoping_and_last_admin.sql
 *        - a project-scoped inspector can grant only on projects they hold, never global/organization
 *          scope, never with a mismatched organization, and cannot touch an admin's global grant or
 *          widen their own grant
 *        - a self-managed organisation's org-wide holder can grant on its own projects only, can
 *          remove its own people but never a JAGS staff member's grant, and loses that power when the
 *          organisation is switched back to full_service
 *        - a plain project user cannot create any grant
 *        NOT covered: the last-admin guard triggers. They only fire when the final active Admin is
 *        removed, which cannot be provoked on a shared project that has other Admins.
 *   3. custom permission org scope       20261105000100_phase1_custom_permission_org_scope_and_evidence_paths.sql
 *        - has_custom_permission() ignores a role defined for organisation A when asked about a
 *          project of organisation B, while global roles and same-organisation roles still match
 *   4. evidence storage path scope       same migration (+ 20261103000100 for registers/ and delete)
 *        - uploading to inspection-evidence needs access to THAT project (not just any project in the
 *          organisation); other organisations' projects, malformed first folders, the registers/
 *          folder (for a non-contributor) and another organisation's standalone folder are refused;
 *          deleting another organisation's evidence object is refused
 *   5. handover certificate write lock   20261020000100_handover_certificate_write_lock.sql
 *        - not even an Admin can insert, update or delete a handover certificate straight through the
 *          API; they remain readable by staff with access to the project
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Checks,
  MARK,
  MISSING_ENV_MESSAGE,
  RUN_ID,
  Teardown,
  must,
  readEnv,
  serviceClient,
  signedInClient,
  type RlsEnv,
} from "./harness";

type StaffRole = "admin" | "inspector" | null;

interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

interface World {
  admin: SupabaseClient;
  checks: Checks;
  teardown: Teardown;
  orgA: string;
  orgB: string;
  projA: string;
  /** A second project in organisation A that clientA holds NO grant on. */
  projA2: string;
  projB: string;
  itpA: string;
  dataBookA: string;
  dataBookA2: string;
  certificateA: string;
  assignmentB: string;
  evidenceB: string;
  clientA: TestUser;
  clientB: TestUser;
  inspectorS: TestUser;
  adminG: TestUser;
  orgHolderO: TestUser;
  targetT: TestUser;
}

// ---------------------------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------------------------

async function createOrg(w: Pick<World, "admin" | "teardown">, label: string): Promise<string> {
  const row = must("org " + label, await w.admin.from("organizations").insert({ name: `${MARK} Org ${label}`, slug: `${MARK}-org-${label}` }).select("id").single());
  w.teardown.add(`org ${label}`, () => w.admin.from("organizations").delete().eq("id", row.id));
  return row.id as string;
}

async function createProject(w: Pick<World, "admin" | "teardown">, orgId: string, label: string): Promise<string> {
  const row = must(
    "project " + label,
    await w.admin.from("projects").insert({ organization_id: orgId, project_number: `${MARK}-PRJ-${label}`, name: `${MARK} Project ${label}` }).select("id").single()
  );
  const id = row.id as string;
  w.teardown.add(`project ${label}`, () => w.admin.from("projects").delete().eq("id", id));
  // The default-folder trigger fills vault_folders on project insert; they must go before the project.
  w.teardown.add(`vault_folders ${label}`, () => w.admin.from("vault_folders").delete().eq("project_id", id));
  return id;
}

async function createUser(
  env: RlsEnv,
  w: Pick<World, "admin" | "teardown">,
  label: string,
  staffRole: StaffRole,
  isStaff: boolean
): Promise<TestUser> {
  const password = `RlsGuard!${RUN_ID}`;
  const email = `rls-guard-${label}-${RUN_ID}@rls-tests.invalid`;
  const created = await w.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `${MARK} ${label}` },
  });
  if (created.error || !created.data.user) throw new Error(`auth user ${label}: ${created.error?.message}`);
  const id = created.data.user.id;
  // Deleting the auth user cascades to public.users and the user's grants (a cascade is exempt from
  // the last-admin trigger by design), so this one step also tidies an admin fixture's global grant.
  w.teardown.add(`user ${label}`, () => w.admin.auth.admin.deleteUser(id));

  if (isStaff) {
    // Service role (no end-user JWT) is trusted by users_guard_privileged_columns.
    const { error } = await w.admin.from("users").update({ is_jags_staff: true, staff_role: staffRole }).eq("id", id);
    if (error) throw new Error(`promote ${label}: ${error.message}`);
  }
  return { id, email, password, client: await signedInClient(env, email, password) };
}

async function createGrant(
  w: Pick<World, "admin">,
  userId: string,
  scope: "global" | "organization" | "project",
  orgId: string | null,
  projectId: string | null,
  role: string
): Promise<string> {
  const row = must(
    `grant ${scope}`,
    await w.admin.from("access_grants").insert({ user_id: userId, scope_type: scope, organization_id: orgId, project_id: projectId, role }).select("id").single()
  );
  return row.id as string;
}

async function buildWorld(env: RlsEnv, admin: SupabaseClient, checks: Checks, teardown: Teardown): Promise<World> {
  const base = { admin, teardown };
  const orgA = await createOrg(base, "a");
  const orgB = await createOrg(base, "b");
  const projA = await createProject(base, orgA, "a");
  const projA2 = await createProject(base, orgA, "a2");
  const projB = await createProject(base, orgB, "b");

  const itp = must("itp A", await admin.from("itps").insert({ project_id: projA, itp_number: `${MARK}-ITP-a`, title: `${MARK} ITP a` }).select("id").single());
  teardown.add("itp A", () => admin.from("itps").delete().eq("id", itp.id));

  const assignment = must(
    "assignment B",
    await admin
      .from("standalone_assignments")
      .insert({ project_id: projB, assignment_number: `${MARK}-SA-b`, assignment_type: "witness_inspection", equipment_description: `${MARK} fixture equipment` })
      .select("id")
      .single()
  );
  teardown.add("assignment B", () => admin.from("standalone_assignments").delete().eq("id", assignment.id));

  const book = must("data book A", await admin.from("data_books").insert({ project_id: projA, book_number: `${MARK}-DB-a`, title: `${MARK} data book a` }).select("id").single());
  teardown.add("data book A", () => admin.from("data_books").delete().eq("id", book.id));
  const book2 = must("data book A2", await admin.from("data_books").insert({ project_id: projA, book_number: `${MARK}-DB-a2`, title: `${MARK} data book a2` }).select("id").single());
  teardown.add("data book A2", () => admin.from("data_books").delete().eq("id", book2.id));

  const certificate = must(
    "certificate A",
    await admin
      .from("handover_certificates")
      .insert({
        data_book_id: book.id,
        certificate_number: `${MARK}-HC-a`,
        package_storage_path: `handover/${book.id}/${MARK}-package.pdf`,
        package_sha256: "0".repeat(64),
      })
      .select("id")
      .single()
  );
  teardown.add("certificate A", () => admin.from("handover_certificates").delete().eq("id", certificate.id));

  const evidenceB = `${projB}/${MARK}-evidence.txt`;
  const upload = await admin.storage.from("inspection-evidence").upload(evidenceB, Buffer.from(`${MARK} fixture evidence`), { contentType: "text/plain" });
  if (upload.error) throw new Error(`fixture evidence upload: ${upload.error.message}`);
  teardown.add("evidence B", () => admin.storage.from("inspection-evidence").remove([evidenceB]));

  const clientA = await createUser(env, base, "client-a", null, false);
  const clientB = await createUser(env, base, "client-b", null, false);
  const inspectorS = await createUser(env, base, "inspector-s", "inspector", true);
  const adminG = await createUser(env, base, "admin-g", "admin", true);
  const orgHolderO = await createUser(env, base, "orgholder-o", null, false);
  const targetT = await createUser(env, base, "target-t", null, false);

  await createGrant(base, clientA.id, "project", orgA, projA, "client");
  await createGrant(base, clientB.id, "project", orgB, projB, "client");
  await createGrant(base, inspectorS.id, "project", orgA, projA, "inspector");
  await createGrant(base, adminG.id, "global", null, null, "admin");
  await createGrant(base, orgHolderO.id, "organization", orgA, null, "client");

  return {
    admin,
    checks,
    teardown,
    orgA,
    orgB,
    projA,
    projA2,
    projB,
    itpA: itp.id as string,
    dataBookA: book.id as string,
    dataBookA2: book2.id as string,
    certificateA: certificate.id as string,
    assignmentB: assignment.id as string,
    evidenceB,
    clientA,
    clientB,
    inspectorS,
    adminG,
    orgHolderO,
    targetT,
  };
}

// ---------------------------------------------------------------------------------------------
// Small helpers for reading state back with the service role (the decisive evidence)
// ---------------------------------------------------------------------------------------------

async function userRow(w: World, id: string) {
  const { data } = await w.admin.from("users").select("full_name, email, is_jags_staff, staff_role, is_active, must_change_password").eq("id", id).maybeSingle();
  return data as { full_name: string; email: string; is_jags_staff: boolean; staff_role: string | null; is_active: boolean; must_change_password: boolean } | null;
}

async function grantExists(w: World, id: string): Promise<boolean> {
  const { data } = await w.admin.from("access_grants").select("id").eq("id", id).maybeSingle();
  return !!data;
}

async function grantCount(w: World, userId: string, projectId: string): Promise<number> {
  const { data } = await w.admin.from("access_grants").select("id").eq("user_id", userId).eq("project_id", projectId);
  return data?.length ?? 0;
}

/** True when a write was refused: either an error came back or no row was affected. */
function refused(result: { error: unknown; data: unknown[] | null }): boolean {
  return !!result.error || (result.data ?? []).length === 0;
}

// ---------------------------------------------------------------------------------------------
// 1. users privilege lockdown
// ---------------------------------------------------------------------------------------------

async function usersPrivilegeLockdown(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("1. users privilege lockdown (20261104000100)");

  const before = await userRow(w, w.clientA.id);
  const attempts: [string, Record<string, unknown>][] = [
    ["is_jags_staff", { is_jags_staff: true }],
    ["staff_role", { staff_role: "admin" }],
    ["is_active", { is_active: false }],
    ["email", { email: `hijack-${RUN_ID}@rls-tests.invalid` }],
    ["must_change_password", { must_change_password: true }],
  ];
  for (const [column, patch] of attempts) {
    const result = await w.clientA.client.from("users").update(patch).eq("id", w.clientA.id).select();
    const after = await userRow(w, w.clientA.id);
    const unchanged = JSON.stringify(after) === JSON.stringify(before);
    checks.check(
      `users: a non-admin cannot change their own ${column}`,
      unchanged && refused(result),
      unchanged ? "write reported success" : `row CHANGED: ${JSON.stringify(after)}`
    );
  }

  // The headline attack: a scoped inspector (already staff) promoting themself to Admin.
  const promote = await w.inspectorS.client.from("users").update({ staff_role: "admin" }).eq("id", w.inspectorS.id).select();
  const inspectorAfter = await userRow(w, w.inspectorS.id);
  checks.check(
    "users: an Inspector cannot promote their own staff_role to admin",
    inspectorAfter?.staff_role === "inspector" && refused(promote),
    `staff_role is now ${inspectorAfter?.staff_role}`
  );

  const rename = await w.clientA.client.from("users").update({ full_name: `${MARK} renamed` }).eq("id", w.clientA.id).select();
  const renamed = await userRow(w, w.clientA.id);
  checks.check(
    "positive-control: a user can still edit their own full_name",
    !rename.error && renamed?.full_name === `${MARK} renamed`,
    rename.error?.message ?? `full_name is ${renamed?.full_name}`
  );

  const del = await w.inspectorS.client.from("users").delete().eq("id", w.targetT.id).select();
  checks.check("users: a non-admin staff member cannot delete a users row", refused(del) && !!(await userRow(w, w.targetT.id)), "the row is gone");

  // Deactivation and forced password change must be honoured by the access helpers themselves.
  const readItp = async () => (await w.clientA.client.from("itps").select("id").eq("id", w.itpA)).data ?? [];
  checks.check("positive-control: active user reads their own project's ITP", (await readItp()).length === 1, "own-project read failed; setup problem");

  await admin.from("users").update({ is_active: false }).eq("id", w.clientA.id);
  checks.check("users: a deactivated account (is_active=false) can no longer read project data", (await readItp()).length === 0, "still reads rows while deactivated");
  await admin.from("users").update({ is_active: true }).eq("id", w.clientA.id);

  await admin.from("users").update({ must_change_password: true }).eq("id", w.clientA.id);
  checks.check("users: an account on a temporary password cannot read project data through the API", (await readItp()).length === 0, "still reads rows while must_change_password");
  await admin.from("users").update({ must_change_password: false }).eq("id", w.clientA.id);

  checks.check("positive-control: access returns once both flags are cleared", (await readItp()).length === 1, "access did not come back");
}

// ---------------------------------------------------------------------------------------------
// 2. access_grants scoping
// ---------------------------------------------------------------------------------------------

async function accessGrantsScoping(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("2. access_grants scoping (20261104000200)");

  const insertGrant = (client: SupabaseClient, row: Record<string, unknown>) => client.from("access_grants").insert(row).select("id");

  // --- Project-scoped JAGS inspector (is_jags_staff, not admin) ---
  const s = w.inspectorS.client;
  const intoB = await insertGrant(s, { user_id: w.targetT.id, scope_type: "project", organization_id: w.orgB, project_id: w.projB, role: "client" });
  checks.check("access_grants: scoped inspector cannot grant on a project they do not hold", refused(intoB) && (await grantCount(w, w.targetT.id, w.projB)) === 0, "grant on another org's project was created");

  const intoA2 = await insertGrant(s, { user_id: w.targetT.id, scope_type: "project", organization_id: w.orgA, project_id: w.projA2, role: "client" });
  checks.check("access_grants: scoped inspector cannot grant on a sibling project they do not hold", refused(intoA2) && (await grantCount(w, w.targetT.id, w.projA2)) === 0, "grant on an un-held project of the same org was created");

  const mismatch = await insertGrant(s, { user_id: w.targetT.id, scope_type: "project", organization_id: w.orgB, project_id: w.projA, role: "client" });
  checks.check("access_grants: organisation must match the project (mismatched organisation_id refused)", refused(mismatch) && (await grantCount(w, w.targetT.id, w.projA)) === 0, "mismatched grant was created");

  const makeGlobal = await insertGrant(s, { user_id: w.targetT.id, scope_type: "global", organization_id: null, project_id: null, role: "admin" });
  checks.check("access_grants: non-admin staff cannot create a global grant", refused(makeGlobal), "global grant created");

  const makeOrg = await insertGrant(s, { user_id: w.targetT.id, scope_type: "organization", organization_id: w.orgA, project_id: null, role: "client" });
  checks.check("access_grants: non-admin staff cannot create an organisation-wide grant", refused(makeOrg), "organisation grant created");

  const ok = await insertGrant(s, { user_id: w.targetT.id, scope_type: "project", organization_id: w.orgA, project_id: w.projA, role: "client" });
  checks.check("positive-control: scoped inspector can grant on their own project", !ok.error && (await grantCount(w, w.targetT.id, w.projA)) === 1, ok.error?.message ?? "grant not found afterwards");
  await admin.from("access_grants").delete().eq("user_id", w.targetT.id);

  // Cannot widen own grant, and cannot touch an Admin's global grant.
  const ownGrant = (await admin.from("access_grants").select("id").eq("user_id", w.inspectorS.id).eq("scope_type", "project").maybeSingle()).data as { id: string } | null;
  const widen = await s.from("access_grants").update({ scope_type: "global", organization_id: null, project_id: null }).eq("id", ownGrant?.id ?? "").select();
  const widened = (await admin.from("access_grants").select("scope_type").eq("id", ownGrant?.id ?? "").maybeSingle()).data as { scope_type: string } | null;
  checks.check("access_grants: scoped inspector cannot widen their own grant to global", widened?.scope_type === "project" && refused(widen), `scope_type is now ${widened?.scope_type}`);

  const adminGrant = (await admin.from("access_grants").select("id, role").eq("user_id", w.adminG.id).eq("scope_type", "global").maybeSingle()).data as { id: string; role: string } | null;
  const editAdmin = await s.from("access_grants").update({ role: "viewer" }).eq("id", adminGrant?.id ?? "").select();
  const adminRoleAfter = (await admin.from("access_grants").select("role").eq("id", adminGrant?.id ?? "").maybeSingle()).data as { role: string } | null;
  checks.check("access_grants: non-admin staff cannot edit an Admin's global grant", adminRoleAfter?.role === adminGrant?.role && refused(editAdmin), `role is now ${adminRoleAfter?.role}`);
  const delAdmin = await s.from("access_grants").delete().eq("id", adminGrant?.id ?? "").select();
  checks.check("access_grants: non-admin staff cannot delete an Admin's global grant", (await grantExists(w, adminGrant?.id ?? "")) && refused(delAdmin), "the Admin's global grant is gone");

  // --- Plain project user ---
  const selfGrant = await insertGrant(w.clientA.client, { user_id: w.clientA.id, scope_type: "project", organization_id: w.orgA, project_id: w.projA2, role: "client" });
  checks.check("access_grants: a plain project user cannot grant themself another project", refused(selfGrant) && (await grantCount(w, w.clientA.id, w.projA2)) === 0, "self-grant was created");

  // --- Organisation-wide holder: only on self_managed / client_managed organisations ---
  const o = w.orgHolderO.client;
  await admin.from("organizations").update({ engagement_scope: "full_service" }).eq("id", w.orgA);
  const fullService = await insertGrant(o, { user_id: w.targetT.id, scope_type: "project", organization_id: w.orgA, project_id: w.projA2, role: "client" });
  checks.check("access_grants: an org-wide holder of a full_service organisation cannot grant", refused(fullService) && (await grantCount(w, w.targetT.id, w.projA2)) === 0, "grant created on a full_service organisation");

  await admin.from("organizations").update({ engagement_scope: "self_managed" }).eq("id", w.orgA);
  const selfManagedOk = await insertGrant(o, { user_id: w.targetT.id, scope_type: "project", organization_id: w.orgA, project_id: w.projA2, role: "client" });
  checks.check("positive-control: org-wide holder of a self_managed organisation can grant on its own project", !selfManagedOk.error && (await grantCount(w, w.targetT.id, w.projA2)) === 1, selfManagedOk.error?.message ?? "grant not found afterwards");

  const foreign = await insertGrant(o, { user_id: w.targetT.id, scope_type: "project", organization_id: w.orgB, project_id: w.projB, role: "client" });
  checks.check("access_grants: that holder cannot grant on another organisation's project", refused(foreign) && (await grantCount(w, w.targetT.id, w.projB)) === 0, "cross-organisation grant was created");

  const removeStaff = await o.from("access_grants").delete().eq("id", ownGrant?.id ?? "").select();
  checks.check("access_grants: that holder cannot remove a JAGS staff member's grant", refused(removeStaff) && (await grantExists(w, ownGrant?.id ?? "")), "the staff member's grant was deleted");

  const removeOwnPeople = await o.from("access_grants").delete().eq("user_id", w.targetT.id).eq("project_id", w.projA2).select();
  checks.check("positive-control: that holder can remove a non-staff person from its own project", !removeOwnPeople.error && (await grantCount(w, w.targetT.id, w.projA2)) === 0, removeOwnPeople.error?.message ?? "grant still present");

  await admin.from("organizations").update({ engagement_scope: "full_service" }).eq("id", w.orgA);
  await admin.from("access_grants").delete().eq("user_id", w.targetT.id);
}

// ---------------------------------------------------------------------------------------------
// 3. custom permission org scope
// ---------------------------------------------------------------------------------------------

async function customPermissionOrgScope(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("3. custom permission org scope (20261105000100)");

  const KEY = "close_ncr";
  const orgRole = must("custom role A", await admin.from("custom_roles").insert({ organization_id: w.orgA, name: `${MARK} org-A role` }).select("id").single());
  w.teardown.add("custom role A", () => admin.from("custom_roles").delete().eq("id", orgRole.id));
  const globalRole = must("custom role global", await admin.from("custom_roles").insert({ organization_id: null, name: `${MARK} global role` }).select("id").single());
  w.teardown.add("custom role global", () => admin.from("custom_roles").delete().eq("id", globalRole.id));

  for (const role of [orgRole, globalRole]) {
    const { error } = await admin.from("custom_role_permissions").insert({ role_id: role.id, permission_key: KEY });
    if (error) throw new Error(`role permission: ${error.message}`);
  }
  // Organisation-A role held organisation-wide (project_id null) by T; the same role held only on
  // project A by S; a JAGS-global role held platform-wide by client B's user.
  const assign = async (roleId: string, userId: string, projectId: string | null) => {
    const { error } = await admin.from("custom_role_assignments").insert({ role_id: roleId, user_id: userId, project_id: projectId });
    if (error) throw new Error(`role assignment: ${error.message}`);
  };
  await assign(orgRole.id, w.targetT.id, null);
  await assign(orgRole.id, w.inspectorS.id, w.projA);
  await assign(globalRole.id, w.clientB.id, null);

  // has_custom_permission is SECURITY DEFINER and executable by `authenticated`.
  const has = async (userId: string, key: string, projectId: string | null) => {
    const { data, error } = await w.clientA.client.rpc("has_custom_permission", {
      target_user_id: userId,
      target_permission_key: key,
      target_project_id: projectId ?? undefined,
    });
    if (error) throw new Error(`has_custom_permission rpc: ${error.message}`);
    return data === true;
  };

  checks.check("positive-control: org-A role held org-wide applies to an org-A project", await has(w.targetT.id, KEY, w.projA), "expected true");
  checks.check("positive-control: org-A role applies to the organisation's other project too", await has(w.targetT.id, KEY, w.projA2), "expected true");
  checks.check("custom permission: an org-A role does NOT apply to an org-B project (H3 cross-organisation leak)", !(await has(w.targetT.id, KEY, w.projB)), "org-A role granted a permission on org B's project");
  checks.check("custom permission: a check with no project still matches a project-less assignment", await has(w.targetT.id, KEY, null), "expected true");
  checks.check("custom permission: a key the role does not hold is false", !(await has(w.targetT.id, "issue_irn", w.projA)), "unheld key reported true");

  checks.check("positive-control: a project-scoped assignment applies to that project", await has(w.inspectorS.id, KEY, w.projA), "expected true");
  checks.check("custom permission: a project-scoped assignment does not apply to a sibling project", !(await has(w.inspectorS.id, KEY, w.projA2)), "leaked to a sibling project");
  checks.check("custom permission: a project-scoped assignment does not apply to another organisation's project", !(await has(w.inspectorS.id, KEY, w.projB)), "leaked to another organisation");

  checks.check("positive-control: a JAGS-global role applies to an org-A project", await has(w.clientB.id, KEY, w.projA), "expected true");
  checks.check("positive-control: a JAGS-global role applies to an org-B project", await has(w.clientB.id, KEY, w.projB), "expected true");
}

// ---------------------------------------------------------------------------------------------
// 4. evidence storage path scope
// ---------------------------------------------------------------------------------------------

async function evidenceStoragePathScope(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("4. evidence storage path scope (20261105000100, 20261103000100)");

  const bucket = w.clientA.client.storage.from("inspection-evidence");
  const uploaded: string[] = [];
  w.teardown.add("evidence uploads by client A", () => admin.storage.from("inspection-evidence").remove(uploaded));
  const tryUpload = async (path: string) => {
    const result = await bucket.upload(path, Buffer.from(`${MARK} probe`), { contentType: "text/plain" });
    if (!result.error) uploaded.push(path);
    return result;
  };

  const own = await tryUpload(`${w.projA}/${MARK}-own.txt`);
  checks.check("positive-control: can upload evidence under a project they hold", !own.error, own.error?.message ?? "");

  const sibling = await tryUpload(`${w.projA2}/${MARK}-sibling.txt`);
  checks.check("storage(inspection-evidence): cannot upload under a sibling project of the same organisation (H7)", !!sibling.error, "upload SUCCEEDED for a project the user holds no grant on");

  const foreign = await tryUpload(`${w.projB}/${MARK}-foreign.txt`);
  checks.check("storage(inspection-evidence): cannot upload under another organisation's project", !!foreign.error, "cross-organisation upload SUCCEEDED");

  const junkFolder = await tryUpload(`not-a-project/${MARK}-junk.txt`);
  checks.check("storage(inspection-evidence): a first folder that is not a project id is refused", !!junkFolder.error, "upload to an arbitrary folder SUCCEEDED");

  const registers = await tryUpload(`${w.projA}/registers/calibration/${MARK}-cert.pdf`);
  checks.check("storage(inspection-evidence): registers/ is closed to a user who is not staff or a register contributor", !!registers.error, "registers/ upload SUCCEEDED for a non-contributor");

  const standalone = await tryUpload(`standalone/${w.assignmentB}/${MARK}-standalone.txt`);
  checks.check("storage(inspection-evidence): cannot upload into another organisation's standalone assignment folder", !!standalone.error, "standalone upload SUCCEEDED");

  await bucket.remove([w.evidenceB]); // refused deletes come back as an error or an empty list; the object is the evidence
  const stillThere = await admin.storage.from("inspection-evidence").download(w.evidenceB);
  checks.check("storage(inspection-evidence): cannot delete another organisation's evidence object", !stillThere.error, "the other organisation's evidence object was deleted");
}

// ---------------------------------------------------------------------------------------------
// 5. handover certificate write lock
// ---------------------------------------------------------------------------------------------

async function handoverCertificateWriteLock(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("5. handover certificate write lock (20261020000100)");

  const snapshot = async () =>
    (await admin.from("handover_certificates").select("certificate_number, package_sha256, acknowledged_at").eq("id", w.certificateA).maybeSingle()).data as
      | { certificate_number: string; package_sha256: string; acknowledged_at: string | null }
      | null;
  const original = await snapshot();

  for (const [label, user] of [
    ["an Admin", w.adminG],
    ["a project-scoped Inspector", w.inspectorS],
  ] as const) {
    const insert = await user.client
      .from("handover_certificates")
      .insert({ data_book_id: w.dataBookA2, certificate_number: `${MARK}-HC-direct`, package_storage_path: `handover/${w.dataBookA2}/x.pdf`, package_sha256: "1".repeat(64) })
      .select("id");
    const created = (await admin.from("handover_certificates").select("id").eq("data_book_id", w.dataBookA2)).data ?? [];
    checks.check(`handover_certificates: ${label} cannot insert a certificate directly`, refused(insert) && created.length === 0, "a certificate row was created through the API");

    const update = await user.client
      .from("handover_certificates")
      .update({ certificate_number: `${MARK}-FORGED`, package_sha256: "f".repeat(64), acknowledged_at: new Date().toISOString() })
      .eq("id", w.certificateA)
      .select("id");
    const afterUpdate = await snapshot();
    checks.check(`handover_certificates: ${label} cannot edit number, hash or acknowledgement`, JSON.stringify(afterUpdate) === JSON.stringify(original) && refused(update), `row now ${JSON.stringify(afterUpdate)}`);

    const del = await user.client.from("handover_certificates").delete().eq("id", w.certificateA).select("id");
    checks.check(`handover_certificates: ${label} cannot delete a certificate`, !!(await snapshot()) && refused(del), "the certificate row was deleted");
  }

  const read = await w.adminG.client.from("handover_certificates").select("id").eq("id", w.certificateA);
  checks.check("positive-control: staff with project access can still read the certificate", (read.data ?? []).length === 1, read.error?.message ?? "certificate not visible");

  const unrelated = await w.clientB.client.from("handover_certificates").select("id").eq("id", w.certificateA);
  checks.check("handover_certificates: a user with no access to the project cannot read it", (unrelated.data ?? []).length === 0, "certificate visible to an unrelated user");
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const env = readEnv();
  if (!env) {
    console.error(MISSING_ENV_MESSAGE);
    process.exit(1);
  }

  const admin = serviceClient(env);
  const checks = new Checks();
  const teardown = new Teardown();
  console.log(`[rls-tests] guards run ${RUN_ID}: creating disposable fixtures...`);

  try {
    const world = await buildWorld(env, admin, checks, teardown);
    await usersPrivilegeLockdown(world);
    await accessGrantsScoping(world);
    await customPermissionOrgScope(world);
    await evidenceStoragePathScope(world);
    await handoverCertificateWriteLock(world);
  } finally {
    console.log("\n[rls-tests] tearing down fixtures...");
    await teardown.runAll();
  }

  if (checks.failures.length > 0) {
    console.error(`\n[rls-tests] ${checks.failures.length} of ${checks.total} guard check(s) FAILED:`);
    for (const f of checks.failures) console.error(`  - ${f.check}: ${f.detail}`);
    process.exit(1);
  }
  console.log(`\n[rls-tests] all ${checks.total} guard checks passed.`);
}

main().catch((error) => {
  console.error("[rls-tests] unexpected error:", error);
  process.exit(1);
});
