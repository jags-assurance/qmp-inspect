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
 *   6. organisation column guard         20261113000700_tighten_project_delete_and_organization_writes.sql
 *        - only an Admin can change an organisation; an org-wide client user of a self-/client-managed
 *          organisation may change the brand colour and nothing else (no engagement_scope rewrite, no
 *          smuggling another column alongside a brand change), and loses even that on full_service
 *   7. project delete is Admin-only      same migration
 *        - an Inspector, a client user, an org-wide holder and another organisation's user cannot delete
 *          a project they can see; an Admin can
 *   8. checklist_response_history        20261113000800_checklist_response_history.sql
 *        - changing an answer keeps its previous value (a no-op save does not); nobody, Admin included,
 *          can edit, delete or forge a history row through the API; it is readable only with project access
 *   9. inspection notice waivers         20261113000300_inspection_notice_waivers.sql
 *        - only JAGS staff with project access, in their own name, on a draft inspection of the same
 *          project, once per level, with a real reason; append-only afterwards; readable with project access
 *  10. NCR client acceptance guard       20261113000100_ncr_client_acceptance_guard.sql
 *        - the required flag is staff-only; only the client party's own login (or an Admin) records the
 *          decision, under their own account and only when required; the client cannot clear it; closing an
 *          NCR that needs acceptance is refused until it is accepted, except a withdrawal
 *  11. seat limit overrides              20261115000101_seat_limit_overrides.sql
 *        - over the seat limit an insert is refused unless an Admin created an override for that user within
 *          ten minutes; the override needs a reason, is single use, is Admin-only to create or read, and a
 *          consumed one cannot be deleted
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
  env: RlsEnv;
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
    env,
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
// Shared fixtures for sections 6-11
// ---------------------------------------------------------------------------------------------

interface ChecklistFixture {
  itpItemId: string;
  templateId: string;
  checklistItemId: string;
}

/** One ITP activity with a checklist template and one checklist item on project A (built once per run). */
let checklistFixtureCache: ChecklistFixture | null = null;
async function checklistFixture(w: World): Promise<ChecklistFixture> {
  if (checklistFixtureCache) return checklistFixtureCache;
  const { admin } = w;
  const section = must("itp section", await admin.from("itp_sections").insert({ itp_id: w.itpA, section_number: 1, title: `${MARK} section` }).select("id").single());
  const item = must("itp item", await admin.from("itp_items").insert({ section_id: section.id, item_number: "1.1", activity: `${MARK} activity` }).select("id").single());
  const template = must(
    "checklist template",
    await admin.from("checklist_templates").insert({ itp_item_id: item.id, checklist_number: `${MARK}-CHK-1`, name: `${MARK} checklist` }).select("id").single()
  );
  const checklistItem = must(
    "checklist item",
    await admin.from("checklist_items").insert({ template_id: template.id, item_number: "1", description: `${MARK} question` }).select("id").single()
  );
  // The ITP (registered earlier in the teardown stack) removes sections, items and templates by cascade.
  checklistFixtureCache = { itpItemId: item.id as string, templateId: template.id as string, checklistItemId: checklistItem.id as string };
  return checklistFixtureCache;
}

async function createInspectionRecord(w: World, label: string, overallResult: "pass" | null): Promise<string> {
  const f = await checklistFixture(w);
  const row = must(
    "inspection record " + label,
    await w.admin
      .from("inspection_records")
      .insert({
        project_id: w.projA,
        itp_item_id: f.itpItemId,
        checklist_template_id: f.templateId,
        record_number: `${MARK}-INSP-${label}`,
        project_name: `${MARK} Project a`,
        itp_number: `${MARK}-ITP-a`,
        activity: `${MARK} activity`,
        overall_result: overallResult,
      })
      .select("id")
      .single()
  );
  const id = row.id as string;
  w.teardown.add(`inspection record ${label}`, () => w.admin.from("inspection_records").delete().eq("id", id));
  return id;
}

// ---------------------------------------------------------------------------------------------
// 6. organisation column guard
// ---------------------------------------------------------------------------------------------

async function organisationColumnGuard(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("6. organisation column guard (20261113000700)");

  type OrgSnapshot = { name: string; engagement_scope: string; brand_primary_color: string | null };
  const snapshot = async () => (await admin.from("organizations").select("name, engagement_scope, brand_primary_color").eq("id", w.orgA).maybeSingle()).data as OrgSnapshot | null;
  const unchanged = async (before: OrgSnapshot | null) => JSON.stringify(await snapshot()) === JSON.stringify(before);

  await admin.from("organizations").update({ engagement_scope: "self_managed", brand_primary_color: null }).eq("id", w.orgA);
  const before = await snapshot();

  const staffRename = await w.inspectorS.client.from("organizations").update({ name: `${MARK} hijacked-by-inspector` }).eq("id", w.orgA).select();
  checks.check("organizations: a non-admin JAGS staff member cannot change an organisation", refused(staffRename) && (await unchanged(before)), `row is now ${JSON.stringify(await snapshot())}`);

  const staffBrand = await w.inspectorS.client.from("organizations").update({ brand_primary_color: "#123456" }).eq("id", w.orgA).select();
  checks.check("organizations: a non-admin JAGS staff member cannot even change the brand columns", refused(staffBrand) && (await unchanged(before)), "brand colour changed by an Inspector");

  const o = w.orgHolderO.client;
  const widen = await o.from("organizations").update({ engagement_scope: "client_managed" }).eq("id", w.orgA).select();
  checks.check("organizations: an org-wide client user cannot rewrite engagement_scope", refused(widen) && (await unchanged(before)), "engagement_scope was rewritten");

  const rename = await o.from("organizations").update({ name: `${MARK} hijacked-by-client` }).eq("id", w.orgA).select();
  checks.check("organizations: an org-wide client user cannot rename the organisation", refused(rename) && (await unchanged(before)), "organisation was renamed");

  const mixed = await o.from("organizations").update({ brand_primary_color: "#abcdef", name: `${MARK} smuggled` }).eq("id", w.orgA).select();
  checks.check("organizations: a brand change cannot smuggle a non-brand column along with it", refused(mixed) && (await unchanged(before)), "mixed update was applied");

  const brand = await o.from("organizations").update({ brand_primary_color: "#112233" }).eq("id", w.orgA).select();
  checks.check("positive-control: an org-wide client user of a self_managed organisation can change the brand colour", !brand.error && (await snapshot())?.brand_primary_color === "#112233", brand.error?.message ?? "brand colour not saved");

  const projectScoped = await w.clientA.client.from("organizations").update({ brand_primary_color: "#445566" }).eq("id", w.orgA).select();
  checks.check("organizations: a project-scoped user cannot change the brand colour", refused(projectScoped) && (await snapshot())?.brand_primary_color === "#112233", "brand colour changed by a project-scoped user");

  await admin.from("organizations").update({ engagement_scope: "full_service" }).eq("id", w.orgA);
  const fullService = await o.from("organizations").update({ brand_primary_color: "#778899" }).eq("id", w.orgA).select();
  checks.check("organizations: once the organisation is full_service the org-wide client user loses the brand edit too", refused(fullService) && (await snapshot())?.brand_primary_color === "#112233", "brand colour changed on a full_service organisation");

  const adminRename = await w.adminG.client.from("organizations").update({ name: `${MARK} Org a (renamed by admin)` }).eq("id", w.orgA).select();
  checks.check("positive-control: an Admin can still change any organisation column", !adminRename.error && (await snapshot())?.name === `${MARK} Org a (renamed by admin)`, adminRename.error?.message ?? "rename not saved");
  await admin.from("organizations").update({ name: `${MARK} Org a`, brand_primary_color: null }).eq("id", w.orgA);
}

// ---------------------------------------------------------------------------------------------
// 7. project delete is Admin-only
// ---------------------------------------------------------------------------------------------

async function projectDeleteAdminOnly(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("7. project delete is Admin-only (20261113000700)");

  const projectId = await createProject(w, w.orgA, "del");
  await createGrant(w, w.inspectorS.id, "project", w.orgA, projectId, "inspector");
  await createGrant(w, w.clientA.id, "project", w.orgA, projectId, "client");
  const exists = async () => !!(await admin.from("projects").select("id").eq("id", projectId).maybeSingle()).data;

  const staffDelete = await w.inspectorS.client.from("projects").delete().eq("id", projectId).select("id");
  checks.check("projects: a project-scoped JAGS Inspector cannot delete a project they can see", refused(staffDelete) && (await exists()), "the project was deleted by an Inspector");

  const clientDelete = await w.clientA.client.from("projects").delete().eq("id", projectId).select("id");
  checks.check("projects: a client user cannot delete a project", refused(clientDelete) && (await exists()), "the project was deleted by a client user");

  const holderDelete = await w.orgHolderO.client.from("projects").delete().eq("id", projectId).select("id");
  checks.check("projects: an org-wide client holder cannot delete a project", refused(holderDelete) && (await exists()), "the project was deleted by an org-wide holder");

  const otherOrgDelete = await w.clientB.client.from("projects").delete().eq("id", projectId).select("id");
  checks.check("projects: a user of another organisation cannot delete a project", refused(otherOrgDelete) && (await exists()), "cross-organisation delete succeeded");

  const adminDelete = await w.adminG.client.from("projects").delete().eq("id", projectId).select("id");
  checks.check("positive-control: an Admin can delete the project", !adminDelete.error && (adminDelete.data ?? []).length === 1 && !(await exists()), adminDelete.error?.message ?? "project still present");
}

// ---------------------------------------------------------------------------------------------
// 8. checklist_response_history is append-only
// ---------------------------------------------------------------------------------------------

async function checklistResponseHistoryAppendOnly(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("8. checklist_response_history is append-only (20261113000800)");

  const f = await checklistFixture(w);
  const recordId = await createInspectionRecord(w, "hist", null);
  const response = must(
    "checklist response",
    await admin.from("checklist_responses").insert({ inspection_record_id: recordId, checklist_item_id: f.checklistItemId, result: "yes", comment: null }).select("id").single()
  );
  const history = async () =>
    ((await admin.from("checklist_response_history").select("id, old_result, old_comment, response_id").eq("inspection_record_id", recordId).order("changed_at")).data ?? []) as {
      id: string;
      old_result: string | null;
      old_comment: string | null;
      response_id: string;
    }[];

  checks.check("checklist_response_history: no history before the first change", (await history()).length === 0, "history rows exist for a never-edited answer");

  // Written by the trigger whoever makes the change; the service role is the least ambiguous way to edit.
  const change = await admin.from("checklist_responses").update({ result: "no", comment: "Cover depth too small" }).eq("id", response.id as string);
  const afterChange = await history();
  checks.check(
    "positive-control: changing an answer writes the previous value to the history",
    !change.error && afterChange.length === 1 && afterChange[0].old_result === "yes" && afterChange[0].response_id === response.id,
    change.error?.message ?? `history is ${JSON.stringify(afterChange)}`
  );

  await admin.from("checklist_responses").update({ result: "no", comment: "Cover depth too small" }).eq("id", response.id as string);
  checks.check("checklist_response_history: a save that changes nothing adds no history row", (await history()).length === 1, "a no-op update created a history row");

  const rowId = afterChange[0]?.id ?? "";
  const snapshot = async () => JSON.stringify(await history());
  const original = await snapshot();

  for (const [label, user] of [
    ["an Admin", w.adminG],
    ["a project-scoped Inspector", w.inspectorS],
    ["a client user", w.clientA],
  ] as const) {
    const edit = await user.client.from("checklist_response_history").update({ old_result: "no", old_comment: "rewritten" }).eq("id", rowId).select("id");
    checks.check(`checklist_response_history: ${label} cannot rewrite a history row`, refused(edit) && (await snapshot()) === original, "a history row was edited through the API");

    const del = await user.client.from("checklist_response_history").delete().eq("id", rowId).select("id");
    checks.check(`checklist_response_history: ${label} cannot delete a history row`, refused(del) && (await snapshot()) === original, "a history row was deleted through the API");

    const forged = await user.client
      .from("checklist_response_history")
      .insert({ response_id: response.id, inspection_record_id: recordId, checklist_item_id: f.checklistItemId, old_result: "yes", old_comment: "forged entry" })
      .select("id");
    checks.check(`checklist_response_history: ${label} cannot insert a history row directly`, refused(forged) && (await snapshot()) === original, "a history row was forged through the API");
  }

  const staffRead = await w.inspectorS.client.from("checklist_response_history").select("id").eq("inspection_record_id", recordId);
  checks.check("positive-control: staff with project access can read the history", (staffRead.data ?? []).length === 1, staffRead.error?.message ?? "history not visible");

  const otherOrgRead = await w.clientB.client.from("checklist_response_history").select("id").eq("inspection_record_id", recordId);
  checks.check("checklist_response_history: a user with no access to the project cannot read it", (otherOrgRead.data ?? []).length === 0, "history visible to an unrelated organisation");
}

// ---------------------------------------------------------------------------------------------
// 9. inspection_notice_waivers
// ---------------------------------------------------------------------------------------------

async function inspectionNoticeWaivers(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("9. inspection notice waivers (20261113000300)");

  const draftId = await createInspectionRecord(w, "waive-draft", null);
  const doneId = await createInspectionRecord(w, "waive-done", "pass");
  const reason = "Client agreed by phone; no witness available";
  const waiversFor = async (recordId: string) => ((await admin.from("inspection_notice_waivers").select("id, reason").eq("inspection_record_id", recordId)).data ?? []) as { id: string; reason: string }[];
  const waiver = (recordId: string, over: Record<string, unknown> = {}) => ({ inspection_record_id: recordId, project_id: w.projA, intervention: "W", reason, waived_by: w.inspectorS.id, ...over });

  const byClient = await w.clientA.client.from("inspection_notice_waivers").insert(waiver(draftId, { waived_by: w.clientA.id })).select("id");
  checks.check("inspection_notice_waivers: a non-staff user cannot record a waiver", refused(byClient) && (await waiversFor(draftId)).length === 0, "a client user created a waiver");

  const spoofed = await w.inspectorS.client.from("inspection_notice_waivers").insert(waiver(draftId, { waived_by: w.adminG.id })).select("id");
  checks.check("inspection_notice_waivers: a waiver cannot be attributed to someone else", refused(spoofed) && (await waiversFor(draftId)).length === 0, "a waiver was recorded in another user's name");

  const wrongProject = await w.inspectorS.client.from("inspection_notice_waivers").insert(waiver(draftId, { project_id: w.projA2 })).select("id");
  checks.check("inspection_notice_waivers: the waiver's project must be the inspection's own project", refused(wrongProject) && (await waiversFor(draftId)).length === 0, "a waiver was stored against a mismatching project");

  const completed = await w.inspectorS.client.from("inspection_notice_waivers").insert(waiver(doneId)).select("id");
  checks.check("inspection_notice_waivers: a completed inspection cannot be waived afterwards", refused(completed) && (await waiversFor(doneId)).length === 0, "a waiver was recorded on a completed inspection");

  const tooShort = await w.inspectorS.client.from("inspection_notice_waivers").insert(waiver(draftId, { reason: "too short" })).select("id");
  checks.check("inspection_notice_waivers: a reason under 10 characters is refused", refused(tooShort) && (await waiversFor(draftId)).length === 0, "a waiver with a short reason was recorded");

  const ok = await w.inspectorS.client.from("inspection_notice_waivers").insert(waiver(draftId)).select("id");
  checks.check("positive-control: JAGS staff with project access can waive a draft inspection", !ok.error && (await waiversFor(draftId)).length === 1, ok.error?.message ?? "waiver not found afterwards");

  const duplicate = await w.inspectorS.client.from("inspection_notice_waivers").insert(waiver(draftId)).select("id");
  checks.check("inspection_notice_waivers: only one waiver per inspection and level", refused(duplicate) && (await waiversFor(draftId)).length === 1, "a second waiver was recorded");

  const original = JSON.stringify(await waiversFor(draftId));
  const waiverId = (await waiversFor(draftId))[0]?.id ?? "";
  for (const [label, user] of [
    ["the staff member who recorded it", w.inspectorS],
    ["an Admin", w.adminG],
  ] as const) {
    const edit = await user.client.from("inspection_notice_waivers").update({ reason: "rewritten after the fact" }).eq("id", waiverId).select("id");
    checks.check(`inspection_notice_waivers: ${label} cannot edit a waiver (append-only)`, refused(edit) && JSON.stringify(await waiversFor(draftId)) === original, "a waiver was edited through the API");
    const del = await user.client.from("inspection_notice_waivers").delete().eq("id", waiverId).select("id");
    checks.check(`inspection_notice_waivers: ${label} cannot delete a waiver (append-only)`, refused(del) && JSON.stringify(await waiversFor(draftId)) === original, "a waiver was deleted through the API");
  }

  const readOwn = await w.clientA.client.from("inspection_notice_waivers").select("id").eq("inspection_record_id", draftId);
  checks.check("positive-control: a user with access to the project can read the waiver", (readOwn.data ?? []).length === 1, readOwn.error?.message ?? "waiver not visible");
  const readOther = await w.clientB.client.from("inspection_notice_waivers").select("id").eq("inspection_record_id", draftId);
  checks.check("inspection_notice_waivers: a user with no access to the project cannot read it", (readOther.data ?? []).length === 0, "waiver visible to an unrelated organisation");
}

// ---------------------------------------------------------------------------------------------
// 10. ncrs_client_acceptance_guard
// ---------------------------------------------------------------------------------------------

async function ncrClientAcceptanceGuard(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("10. NCR client acceptance guard (20261113000100)");

  // clientA becomes the project's client party login (is_project_client_party_user).
  const party = must("client party", await admin.from("project_parties").insert({ project_id: w.projA, party_type: "client", name: `${MARK} Client party`, user_id: w.clientA.id }).select("id").single());
  w.teardown.add("client party", () => admin.from("project_parties").delete().eq("id", party.id));

  const ncr = must(
    "ncr",
    await admin
      .from("ncrs")
      .insert({
        project_id: w.projA,
        ncr_number: `${MARK}-NCR-a`,
        severity: "minor_ncr",
        description: `${MARK} fixture NCR`,
        status: "pending_verification",
        root_cause: "rc",
        corrective_action: "ca",
        preventive_action: "pa",
        verification_notes: "verified",
        client_acceptance_required: false,
      })
      .select("id")
      .single()
  );
  const ncrId = ncr.id as string;
  w.teardown.add("ncr", () => admin.from("ncrs").delete().eq("id", ncrId));

  type NcrState = { client_acceptance_required: boolean; client_acceptance_decision: string | null; client_accepted_by: string | null; status: string };
  const state = async () =>
    (await admin.from("ncrs").select("client_acceptance_required, client_acceptance_decision, client_accepted_by, status").eq("id", ncrId).maybeSingle()).data as NcrState | null;
  // Service-role writes are trusted by the guard, so they set the scene without being what is tested.
  const setScene = (patch: Record<string, unknown>) => admin.from("ncrs").update(patch).eq("id", ncrId);
  const blank = {
    client_acceptance_required: false,
    client_accepted_at: null,
    client_accepted_by: null,
    client_acceptance_decision: null,
    client_acceptance_comment: null,
    status: "pending_verification",
    withdrawn_at: null,
    closed_at: null,
    closed_by: null,
  };
  const accept = (userId: string) => ({ client_accepted_at: new Date().toISOString(), client_accepted_by: userId, client_acceptance_decision: "accepted", client_acceptance_comment: "Fine by us" });

  // --- the "required" flag is staff-only ---
  await setScene(blank);
  const flagByClient = await w.clientA.client.from("ncrs").update({ client_acceptance_required: true }).eq("id", ncrId).select("id");
  checks.check("ncrs: the client cannot switch client acceptance on or off", refused(flagByClient) && (await state())?.client_acceptance_required === false, "client_acceptance_required was changed by a non-staff user");

  const flagByStaff = await w.inspectorS.client.from("ncrs").update({ client_acceptance_required: true }).eq("id", ncrId).select("id");
  checks.check("positive-control: JAGS staff can require client acceptance", !flagByStaff.error && (await state())?.client_acceptance_required === true, flagByStaff.error?.message ?? "flag not set");

  // --- who may record the decision ---
  const byStaff = await w.inspectorS.client.from("ncrs").update(accept(w.inspectorS.id)).eq("id", ncrId).select("id");
  checks.check("ncrs: a non-admin staff member cannot record the client's decision", refused(byStaff) && (await state())?.client_acceptance_decision === null, "an Inspector recorded the client's acceptance");

  const byOrgHolder = await w.orgHolderO.client.from("ncrs").update(accept(w.orgHolderO.id)).eq("id", ncrId).select("id");
  checks.check("ncrs: a user who is not the project's client party cannot record the decision", refused(byOrgHolder) && (await state())?.client_acceptance_decision === null, "a non-client user recorded the decision");

  const impersonated = await w.clientA.client.from("ncrs").update(accept(w.adminG.id)).eq("id", ncrId).select("id");
  checks.check("ncrs: the decision must be recorded under the caller's own account", refused(impersonated) && (await state())?.client_acceptance_decision === null, "the decision was recorded in another user's name");

  await setScene({ client_acceptance_required: false });
  const notRequired = await w.clientA.client.from("ncrs").update(accept(w.clientA.id)).eq("id", ncrId).select("id");
  checks.check("ncrs: no decision can be recorded when acceptance is not required", refused(notRequired) && (await state())?.client_acceptance_decision === null, "a decision was recorded on an NCR that does not need one");

  await setScene({ client_acceptance_required: true });
  const own = await w.clientA.client.from("ncrs").update(accept(w.clientA.id)).eq("id", ncrId).select("id");
  checks.check(
    "positive-control: the client's own login can record the decision",
    !own.error && (await state())?.client_acceptance_decision === "accepted" && (await state())?.client_accepted_by === w.clientA.id,
    own.error?.message ?? "decision not saved"
  );

  const clearByClient = await w.clientA.client
    .from("ncrs")
    .update({ client_accepted_at: null, client_accepted_by: null, client_acceptance_decision: null, client_acceptance_comment: null })
    .eq("id", ncrId)
    .select("id");
  checks.check("ncrs: the client cannot clear its own decision afterwards (staff only)", refused(clearByClient) && (await state())?.client_acceptance_decision === "accepted", "a non-staff user cleared the decision");

  // --- closing is held until the client accepted ---
  await setScene({ ...blank, client_acceptance_required: true });
  const closeBlocked = await w.adminG.client.from("ncrs").update({ status: "closed" }).eq("id", ncrId).select("id");
  checks.check(
    "ncrs: an NCR that needs client acceptance cannot be closed without an accepted decision",
    refused(closeBlocked) && (await state())?.status === "pending_verification",
    "the NCR was closed without the client's acceptance"
  );

  await setScene({ ...blank, client_acceptance_required: true, client_acceptance_decision: "rejected", client_accepted_by: w.clientA.id, client_accepted_at: new Date().toISOString(), client_acceptance_comment: "Not acceptable" });
  const closeAfterRejection = await w.adminG.client.from("ncrs").update({ status: "closed" }).eq("id", ncrId).select("id");
  checks.check("ncrs: a rejected disposition also blocks closing", refused(closeAfterRejection) && (await state())?.status === "pending_verification", "the NCR was closed after the client rejected it");

  await setScene({ ...blank, client_acceptance_required: true, ...accept(w.clientA.id) });
  const closeAccepted = await w.adminG.client.from("ncrs").update({ status: "closed" }).eq("id", ncrId).select("id");
  checks.check("positive-control: an accepted disposition lets an Admin close the NCR", !closeAccepted.error && (await state())?.status === "closed", closeAccepted.error?.message ?? "NCR not closed");

  // --- a withdrawal is exempt (raised in error, nothing to accept) ---
  await setScene({ ...blank, client_acceptance_required: true });
  const withdraw = await w.adminG.client
    .from("ncrs")
    .update({ status: "closed", withdrawn_at: new Date().toISOString(), withdrawn_reason: "Raised in error" })
    .eq("id", ncrId)
    .select("id");
  checks.check("positive-control: withdrawing an NCR does not need the client's acceptance", !withdraw.error && (await state())?.status === "closed", withdraw.error?.message ?? "NCR not withdrawn");
}

// ---------------------------------------------------------------------------------------------
// 11. seat_limit_overrides
// ---------------------------------------------------------------------------------------------

async function seatLimitOverrides(w: World): Promise<void> {
  const { checks, admin } = w;
  checks.section("11. seat limit overrides (20261115000101)");

  const orgC = await createOrg(w, "c");
  const plan = await admin.from("organization_plans").upsert({ organization_id: orgC, plan_tier: "starter", seat_limit: 1 }, { onConflict: "organization_id" });
  if (plan.error) throw new Error(`organization plan: ${plan.error.message}`);
  const seated = await createUser(w.env, w, "seat-x", null, false);
  const second = await createUser(w.env, w, "seat-y", null, false);
  const third = await createUser(w.env, w, "seat-z", null, false);
  const stale = await createUser(w.env, w, "seat-w", null, false);
  await createGrant(w, seated.id, "organization", orgC, null, "client"); // the one allowed seat

  const grantFor = (client: SupabaseClient, userId: string) =>
    client.from("access_grants").insert({ user_id: userId, scope_type: "organization", organization_id: orgC, project_id: null, role: "client" }).select("id");
  const hasGrant = async (userId: string) => ((await admin.from("access_grants").select("id").eq("user_id", userId).eq("organization_id", orgC)).data ?? []).length > 0;
  const overrides = async (userId: string) =>
    ((await admin.from("seat_limit_overrides").select("id, consumed_at").eq("organization_id", orgC).eq("user_id", userId)).data ?? []) as { id: string; consumed_at: string | null }[];
  const requestOverride = (client: SupabaseClient, userId: string, reason = "Contractor surge on site") =>
    client.from("seat_limit_overrides").insert({ organization_id: orgC, user_id: userId, reason }).select("id");

  const blocked = await grantFor(w.adminG.client, second.id);
  checks.check("seat limit: without an override an Admin cannot exceed the seat limit", refused(blocked) && !(await hasGrant(second.id)), "a grant was created over the seat limit");
  checks.check("seat limit: the refusal says why", /seat limit/i.test(blocked.error?.message ?? ""), `message was: ${blocked.error?.message}`);

  const byInspector = await requestOverride(w.inspectorS.client, second.id);
  checks.check("seat_limit_overrides: a non-admin staff member cannot create an override", refused(byInspector) && (await overrides(second.id)).length === 0, "an Inspector created an override");
  const byClient = await requestOverride(w.clientA.client, second.id);
  checks.check("seat_limit_overrides: a client user cannot create an override", refused(byClient) && (await overrides(second.id)).length === 0, "a client user created an override");

  const noReason = await requestOverride(w.adminG.client, second.id, "no");
  checks.check("seat_limit_overrides: an override needs a reason of at least 5 characters", refused(noReason) && (await overrides(second.id)).length === 0, "an override without a reason was created");

  const granted = await requestOverride(w.adminG.client, second.id);
  checks.check("positive-control: an Admin can create an override with a reason", !granted.error && (await overrides(second.id)).length === 1, granted.error?.message ?? "override not found afterwards");

  const wrongUser = await grantFor(w.adminG.client, third.id);
  checks.check("seat limit: an override for one user does not let another user in", refused(wrongUser) && !(await hasGrant(third.id)), "a different user was seated on someone else's override");

  const inspectorReads = await w.inspectorS.client.from("seat_limit_overrides").select("id").eq("organization_id", orgC);
  checks.check("seat_limit_overrides: only Admins can read overrides", (inspectorReads.data ?? []).length === 0, "an Inspector can read the override audit records");

  const inspectorDeletes = await w.inspectorS.client.from("seat_limit_overrides").delete().eq("organization_id", orgC).eq("user_id", second.id).select("id");
  checks.check("seat_limit_overrides: a non-admin cannot delete an unused override", refused(inspectorDeletes) && (await overrides(second.id)).length === 1, "an Inspector deleted an override");

  const seatedUnderOverride = await grantFor(w.adminG.client, second.id);
  const afterSeat = await overrides(second.id);
  checks.check("positive-control: the override lets that user be added", !seatedUnderOverride.error && (await hasGrant(second.id)), seatedUnderOverride.error?.message ?? "grant not created");
  checks.check("seat limit: the override is consumed by the insert it allowed (single use)", afterSeat.length === 1 && afterSeat[0].consumed_at !== null, `override state: ${JSON.stringify(afterSeat)}`);

  const deleteConsumed = await w.adminG.client.from("seat_limit_overrides").delete().eq("id", afterSeat[0]?.id ?? "").select("id");
  checks.check("seat_limit_overrides: a consumed override is kept as the audit record (cannot be deleted)", refused(deleteConsumed) && (await overrides(second.id)).length === 1, "a consumed override was deleted");

  // Single use: once that user's grant is gone the consumed override cannot seat them a second time.
  await admin.from("access_grants").delete().eq("user_id", second.id).eq("organization_id", orgC);
  const reuse = await grantFor(w.adminG.client, second.id);
  checks.check("seat limit: a consumed override cannot be reused", refused(reuse) && !(await hasGrant(second.id)), "a consumed override seated the user a second time");

  // An override older than ten minutes no longer counts.
  const old = await admin.from("seat_limit_overrides").insert({ organization_id: orgC, user_id: stale.id, reason: "Granted an hour ago", created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
  if (old.error) throw new Error(`stale override fixture: ${old.error.message}`);
  const expired = await grantFor(w.adminG.client, stale.id);
  checks.check("seat limit: an override older than ten minutes is ignored", refused(expired) && !(await hasGrant(stale.id)), "an expired override seated a user");
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
    await organisationColumnGuard(world);
    await projectDeleteAdminOnly(world);
    await checklistResponseHistoryAppendOnly(world);
    await inspectionNoticeWaivers(world);
    await ncrClientAcceptanceGuard(world);
    await seatLimitOverrides(world);
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
