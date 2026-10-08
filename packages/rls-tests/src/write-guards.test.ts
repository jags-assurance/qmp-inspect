/**
 * Write-guard suite: for each database write guard added by the hardening migrations (see
 * GUARD_COVERAGE.md for the full guard -> test table), a WRONG-ROLE check that must be refused and a
 * RIGHT-ROLE check that must succeed, through the same path a browser session uses (anon key + a real
 * password session, so every probe goes through RLS and the triggers exactly as in production).
 *
 * THIS SUITE WRITES. There is no staging database; the only Supabase project is the real one. It creates
 * disposable, `__rls_write_guard_<run>__`-marked organisations, users, projects and rows with the service
 * role, and deletes exactly those in a `finally` block (it never deletes anything it did not create in
 * this run). It therefore refuses to start unless explicitly armed (src/gate.ts):
 *
 *     RLS_ALLOW_WRITES=1
 *     RLS_CONFIRM_SUPABASE_URL=<the SUPABASE_URL it will write to>
 *
 * plus SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY as for the other suites. Without
 * RLS_ALLOW_WRITES=1 it prints a skip message and exits 0. It is NOT part of `pnpm test`; run it with
 * `pnpm --filter @jags/rls-tests test:write-guards` (also part of `test:all`, which is itself opt-in).
 *
 * Every check is registered against a guard with `guard("<name>")`. coverage.test.ts (offline) fails when
 * a guard in the migrations has no registry entry, and this suite fails at run time when a guard it
 * claims to cover did not execute at least one refused AND one allowed check (so a scenario that crashed
 * early cannot pass silently). W1..W14 below are the section ids used in guard-registry.ts.
 *
 * The scenarios were also exercised as plain SQL (set role authenticated + request.jwt.claim.sub) on a
 * local Postgres 16 with the full migration chain applied, which is where the expected outcomes come from;
 * this TypeScript has not been run against any Supabase project.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Checks, RUN_ID, Teardown, must, serviceClient, signedInClient, type RlsEnv } from "./harness";
import { GUARD_REGISTRY } from "./guard-registry";
import { liveWriteGate } from "./gate";

/** Distinct from the older suites' markers so leftovers are attributable to this suite. */
const MARK = `__rls_write_guard_${RUN_ID}__`;

type StaffRole = "admin" | "inspector" | null;
type Res = { error: { message: string; code?: string } | null; data?: unknown };

interface Actor {
  id: string;
  email: string;
  client: SupabaseClient;
}

interface World {
  env: RlsEnv;
  admin: SupabaseClient;
  checks: Checks;
  teardown: Teardown;
  seen: Map<string, { refused: number; allowed: number }>;
  orgA: string;
  orgB: string;
  adminG: Actor;
  adminH: Actor;
  inspectorS: Actor;
  clientA: Actor;
  orgHolderO: Actor;
  contractorC: Actor;
  clientB: Actor;
}

// ---------------------------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------------------------

const rowCount = (r: Res) => (Array.isArray(r.data) ? r.data.length : 0);
const show = (r: Res) => (r.error ? `error ${r.error.code ?? ""} ${r.error.message}` : `rows=${rowCount(r)}`);
const codeIs = (r: Res, code: string) => r.error?.code === code;

/** A named group of checks for one or more guards; each refused / allowed check is counted for every id. */
function guard(w: World, ...ids: string[]) {
  const bump = (kind: "refused" | "allowed") => {
    for (const id of ids) {
      const s = w.seen.get(id) ?? { refused: 0, allowed: 0 };
      s[kind] += 1;
      w.seen.set(id, s);
    }
  };
  const tag = `[${ids[0]}]`;
  return {
    /** An UPDATE/DELETE that must change nothing: an error, or RLS filtered every row out. */
    refuseRows(desc: string, r: Res, stateUnchanged = true) {
      bump("refused");
      w.checks.check(`${tag} REFUSED ${desc}`, (!!r.error || rowCount(r) === 0) && stateUnchanged, stateUnchanged ? `write went through: ${show(r)}` : `state CHANGED despite ${show(r)}`);
    },
    /** An INSERT or RPC that must fail with an error. */
    refuseCall(desc: string, r: Res, stateUnchanged = true) {
      bump("refused");
      w.checks.check(`${tag} REFUSED ${desc}`, !!r.error && stateUnchanged, r.error ? "state CHANGED despite the error" : "call succeeded");
    },
    /** An UPDATE/DELETE (with .select) that must affect at least one row. */
    allowRows(desc: string, r: Res, expectation = true) {
      bump("allowed");
      w.checks.check(`${tag} ALLOWED ${desc}`, !r.error && rowCount(r) > 0 && expectation, `${show(r)}${expectation ? "" : " but the expected state was not reached"}`);
    },
    /** An INSERT or RPC that must succeed. */
    allowCall(desc: string, r: Res, expectation = true) {
      bump("allowed");
      w.checks.check(`${tag} ALLOWED ${desc}`, !r.error && expectation, r.error ? show(r) : "succeeded but the expected state was not reached");
    },
    /** An extra assertion that is not itself a refusal / allowance (forced values, stored state). */
    note(desc: string, cond: boolean, detail: string) {
      w.checks.check(`${tag} ${desc}`, cond, detail);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fixtures (all created with the service role, all removed in `finally`)
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

async function createUser(env: RlsEnv, w: Pick<World, "admin" | "teardown">, label: string, staffRole: StaffRole, isStaff: boolean): Promise<Actor> {
  const password = `RlsWrite!${RUN_ID}`;
  const email = `rls-write-${label}-${RUN_ID}@rls-tests.invalid`;
  const created = await w.admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `${MARK} ${label}` } });
  if (created.error || !created.data.user) throw new Error(`auth user ${label}: ${created.error?.message}`);
  const id = created.data.user.id;
  // Deleting the auth user cascades to public.users and the user's grants (a cascade is exempt from the
  // last-admin trigger by design), so this one step also tidies an admin fixture's global grant.
  w.teardown.add(`user ${label}`, () => w.admin.auth.admin.deleteUser(id));
  if (isStaff) {
    const { error } = await w.admin.from("users").update({ is_jags_staff: true, staff_role: staffRole }).eq("id", id);
    if (error) throw new Error(`promote ${label}: ${error.message}`);
  }
  return { id, email, client: await signedInClient(env, email, password) };
}

async function createGrant(admin: SupabaseClient, userId: string, scope: "global" | "organization" | "project", orgId: string | null, projectId: string | null, role: string): Promise<void> {
  must(`grant ${scope}`, await admin.from("access_grants").insert({ user_id: userId, scope_type: scope, organization_id: orgId, project_id: projectId, role }).select("id").single());
}

interface ProjectOpts {
  org?: string;
  inspector?: boolean;
  client?: boolean;
  contractor?: boolean;
}

/** A project in organisation A (or `org`) where the inspector, client and contractor fixtures each hold a project grant. Admins hold global grants. */
async function newProject(w: World, label: string, opts: ProjectOpts = {}): Promise<string> {
  const org = opts.org ?? w.orgA;
  const id = await createProject(w, org, label);
  if (opts.inspector !== false) await createGrant(w.admin, w.inspectorS.id, "project", org, id, "inspector");
  if (opts.client !== false) await createGrant(w.admin, w.clientA.id, "project", org, id, "client");
  if (opts.contractor !== false) await createGrant(w.admin, w.contractorC.id, "project", org, id, "contractor");
  return id;
}

interface Activity {
  itpId: string;
  itemId: string;
  sectionId: string;
  templateId: string;
  checklistItemId: string;
  itpNumber: string;
}

async function newActivity(w: World, projectId: string, label: string): Promise<Activity> {
  const { admin } = w;
  const itpNumber = `${MARK}-ITP-${label}`;
  const itp = must("itp " + label, await admin.from("itps").insert({ project_id: projectId, itp_number: itpNumber, title: `${MARK} ITP ${label}` }).select("id").single());
  const section = must("itp section " + label, await admin.from("itp_sections").insert({ itp_id: itp.id, section_number: 1, title: `${MARK} section ${label}` }).select("id").single());
  const item = must("itp item " + label, await admin.from("itp_items").insert({ section_id: section.id, item_number: "1.1", activity: `${MARK} activity ${label}` }).select("id").single());
  const template = must(
    "checklist template " + label,
    await admin.from("checklist_templates").insert({ itp_item_id: item.id, checklist_number: `${MARK}-CHK-${label}`, name: `${MARK} checklist ${label}` }).select("id").single()
  );
  const checklistItem = must("checklist item " + label, await admin.from("checklist_items").insert({ template_id: template.id, item_number: "1", description: `${MARK} question ${label}` }).select("id").single());
  // The project (registered earlier in the teardown stack) removes the ITP and everything under it by cascade.
  return {
    itpId: itp.id as string,
    itemId: item.id as string,
    sectionId: section.id as string,
    templateId: template.id as string,
    checklistItemId: checklistItem.id as string,
    itpNumber,
  };
}

async function newRecord(w: World, projectId: string, act: Activity, label: string, overall: "pass" | "partial" | null): Promise<string> {
  const id = randomUUID();
  must(
    "inspection record " + label,
    await w.admin
      .from("inspection_records")
      .insert({
        id,
        project_id: projectId,
        itp_item_id: act.itemId,
        checklist_template_id: act.templateId,
        record_number: `${MARK}-INSP-${label}`,
        project_name: `${MARK} project`,
        itp_number: act.itpNumber,
        activity: `${MARK} activity`,
        overall_result: overall,
      })
      .select("id")
      .single()
  );
  return id;
}

async function ncrRow(w: World, id: string) {
  const { data } = await w.admin
    .from("ncrs")
    .select("status, severity, raised_by, closed_by, closed_at, reopen_count, root_cause, request_id")
    .eq("id", id)
    .maybeSingle();
  return data as { status: string; severity: string; raised_by: string | null; closed_by: string | null; closed_at: string | null; reopen_count: number; root_cause: string | null; request_id: string | null } | null;
}

// ---------------------------------------------------------------------------------------------
// W1. projects_column_guard + projects update policy (20261118000100)
// ---------------------------------------------------------------------------------------------

async function w1ProjectsColumnGuard(w: World): Promise<void> {
  w.checks.section("W1. projects_column_guard + projects update policy (20261118000100)");
  const g = guard(w, "projects_column_guard", "projects");
  const org = await createOrg(w, "w1");
  await w.admin.from("organizations").update({ engagement_scope: "full_service" }).eq("id", org);
  const proj = await newProject(w, "w1", { org });
  await createGrant(w.admin, w.orgHolderO.id, "organization", org, null, "client");

  const snap = async () =>
    JSON.stringify(
      (await w.admin.from("projects").select("name, site_location, allow_client_execution, enforce_hold_blocks_start, status, organization_id, responsible_person_id").eq("id", proj).single()).data
    );
  const read = async () => (await w.admin.from("projects").select("name, site_location, allow_client_execution").eq("id", proj).single()).data as { name: string; site_location: string | null; allow_client_execution: boolean };
  const upd = (c: SupabaseClient, patch: Record<string, unknown>) => c.from("projects").update(patch).eq("id", proj).select("id");

  let before = await snap();
  g.refuseRows("a project-scoped JAGS Inspector cannot update a project of a full-service organisation", await upd(w.inspectorS.client, { name: `${MARK} renamed by inspector` }), (await snap()) === before);
  g.refuseRows("a project-scoped client user cannot update a project of a full-service organisation", await upd(w.clientA.client, { name: `${MARK} renamed by client` }), (await snap()) === before);
  const adminEdit = await upd(w.adminG.client, { name: `${MARK} Project w1 (admin)`, allow_client_execution: true });
  g.allowRows("an Admin can change any project column (name and allow_client_execution)", adminEdit, (await read()).allow_client_execution === true);

  // A self-managed organisation's own people may keep editing the descriptive details...
  await w.admin.from("organizations").update({ engagement_scope: "self_managed" }).eq("id", org);
  const descriptive = await upd(w.orgHolderO.client, { name: `${MARK} Project w1 (holder)`, site_location: "Dock 4" });
  g.allowRows("an org-wide client user of a self-managed organisation can edit the descriptive columns", descriptive, (await read()).site_location === "Dock 4");

  // ...and nothing else.
  before = await snap();
  const forbidden: [string, Record<string, unknown>][] = [
    ["allow_client_execution", { allow_client_execution: false }],
    ["enforce_hold_blocks_start", { enforce_hold_blocks_start: false }],
    ["status", { status: "on_hold" }],
    ["organization_id (moving the project to another organisation)", { organization_id: w.orgB }],
    ["responsible_person_id", { responsible_person_id: w.orgHolderO.id }],
  ];
  for (const [column, patch] of forbidden) {
    g.refuseRows(`an org-wide client user cannot change ${column}`, await upd(w.orgHolderO.client, patch), (await snap()) === before);
  }
  g.refuseRows("a non-admin JAGS Inspector cannot change a project switch even on a self-managed organisation", await upd(w.inspectorS.client, { enforce_hold_blocks_start: false }), (await snap()) === before);
  g.allowRows("an Admin can still change every column on a self-managed organisation's project", await upd(w.adminG.client, { enforce_hold_blocks_start: true }), true);
}

// ---------------------------------------------------------------------------------------------
// W2. projects_status_guard + project_write_guard (20261019S70004, 20261104000600)
// ---------------------------------------------------------------------------------------------

async function w2CloseProject(w: World): Promise<void> {
  w.checks.section("W2. close project: projects_status_guard + project_write_guard (20261019S70004, 20261104000600)");
  const gs = guard(w, "projects_status_guard");
  const gw = guard(w, "project_write_guard");
  const proj = await newProject(w, "w2");
  const openNcr = randomUUID();
  must("w2 open ncr", await w.admin.from("ncrs").insert({ id: openNcr, project_id: proj, ncr_number: `${MARK}-NCR-w2-1`, severity: "minor_ncr", description: `${MARK} open NCR blocks the close` }).select("id").single());

  const state = async () => (await w.admin.from("projects").select("status, closed_reason, closed_by").eq("id", proj).single()).data as { status: string; closed_reason: string | null; closed_by: string | null };
  const close = (c: SupabaseClient, reason: string | null) => c.rpc("close_project", { p_project_id: proj, p_reason: reason });
  const setStatus = (c: SupabaseClient, status: string) => c.from("projects").update({ status }).eq("id", proj).select("id");
  const stillActive = async () => (await state()).status === "active";

  gs.refuseRows("a project-scoped Inspector cannot complete a project by a direct status update", await setStatus(w.inspectorS.client, "completed"), await stillActive());
  gs.refuseCall("a project-scoped Inspector cannot call close_project", await close(w.inspectorS.client, "Client accepted the open items"), await stillActive());
  gs.refuseCall("a client user cannot call close_project", await close(w.clientA.client, "Client accepted the open items"), await stillActive());
  gs.refuseRows("an Admin cannot complete a project with an open NCR by a direct update", await setStatus(w.adminG.client, "completed"), await stillActive());
  gs.refuseCall("close_project with an open NCR and no reason is refused", await close(w.adminG.client, null), await stillActive());
  gs.refuseCall("close_project with a too-short override reason is refused", await close(w.adminG.client, "ok"), await stillActive());
  const reason = "Client accepted the open items";
  const closed = await close(w.adminG.client, reason);
  const after = await state();
  gs.allowCall("an Admin closes the project with a real override reason (reason, time and closer are stored)", closed, after.status === "completed" && after.closed_reason === reason && after.closed_by === w.adminG.id);

  // The completed-project write lock.
  const newNcr = (c: SupabaseClient, n: string) =>
    c.from("ncrs").insert({ id: randomUUID(), project_id: proj, ncr_number: `${MARK}-NCR-w2-${n}`, severity: "minor_ncr", description: `${MARK} raised on a closed project` });
  gw.refuseCall("a project-scoped Inspector cannot raise an NCR on a completed project", await newNcr(w.inspectorS.client, "2"));
  gw.refuseRows("a project-scoped Inspector cannot edit an NCR on a completed project", await w.inspectorS.client.from("ncrs").update({ description: `${MARK} edited after the close` }).eq("id", openNcr).select("id"));
  gw.allowCall("an Admin is exempt from the completed-project lock", await newNcr(w.adminG.client, "3"));

  gs.refuseRows("an Inspector cannot re-open a completed project", await setStatus(w.inspectorS.client, "active"), (await state()).status === "completed");
  gs.allowRows("an Admin can re-open a completed project", await setStatus(w.adminG.client, "active"), await stillActive());
  gw.allowCall("once re-opened, the Inspector can raise NCRs again", await newNcr(w.inspectorS.client, "4"));
}

// ---------------------------------------------------------------------------------------------
// W3. project_parties_enforce_type_limit (20261118000500)
// ---------------------------------------------------------------------------------------------

async function w3PartyTypeLimit(w: World): Promise<void> {
  w.checks.section("W3. project_parties_enforce_type_limit (20261118000500)");
  const g = guard(w, "project_parties_enforce_type_limit");
  const proj = await newProject(w, "w3");
  // The cap for `client` is 10 active parties (PARTY_TYPE_LIMITS in apps/web/lib/projects/party-limits.ts).
  must("w3 seed parties", await w.admin.from("project_parties").insert(Array.from({ length: 9 }, (_, i) => ({ project_id: proj, party_type: "client", name: `${MARK} seed client ${i + 1}` }))).select("id"));
  const addParty = (c: SupabaseClient, type: string, name: string, extra: Record<string, unknown> = {}) =>
    c.from("project_parties").insert({ project_id: proj, party_type: type, name: `${MARK} ${name}`, ...extra });
  const activeClients = async () => ((await w.admin.from("project_parties").select("id").eq("project_id", proj).eq("party_type", "client").eq("is_active", true)).data ?? []).length;

  g.refuseCall("a client user cannot add a party at all (row-level security)", await addParty(w.clientA.client, "client", "by client"), (await activeClients()) === 9);
  g.allowCall("JAGS staff can add the 10th active client party", await addParty(w.inspectorS.client, "client", "tenth client"), (await activeClients()) === 10);
  const eleventh = await addParty(w.inspectorS.client, "client", "eleventh client");
  g.refuseCall("the 11th active client party is refused with 23514", eleventh, codeIs(eleventh, "23514") && (await activeClients()) === 10);
  g.refuseCall("the cap binds an Admin too", await addParty(w.adminG.client, "client", "eleventh by admin"), (await activeClients()) === 10);
  g.allowCall("another party type is counted separately (a vendor is still allowed)", await addParty(w.adminG.client, "vendor", "vendor one"));
  const retype = await w.adminG.client.from("project_parties").update({ party_type: "client" }).eq("project_id", proj).eq("party_type", "vendor").select("id");
  g.refuseRows("changing an active party's type into a full type is refused", retype, (await activeClients()) === 10);
  g.allowRows("deactivating a client party frees a slot", await w.adminG.client.from("project_parties").update({ is_active: false }).eq("project_id", proj).eq("name", `${MARK} seed client 1`).select("id"), (await activeClients()) === 9);
  g.allowCall("a new client party fits once a slot is free", await addParty(w.adminG.client, "client", "client after a slot freed"), (await activeClients()) === 10);
  g.allowCall("an inactive party over the cap is allowed (only active parties count)", await addParty(w.adminG.client, "client", "inactive extra", { is_active: false }));
}

// ---------------------------------------------------------------------------------------------
// W4. inspection_comments_guard + policies (20261120000100)
// ---------------------------------------------------------------------------------------------

async function w4InspectionComments(w: World): Promise<void> {
  w.checks.section("W4. inspection_comments_guard + policies (20261120000100)");
  const g = guard(w, "inspection_comments_guard", "inspection_comments");
  const proj = await newProject(w, "w4");
  const actDone = await newActivity(w, proj, "w4-done");
  const actDraft = await newActivity(w, proj, "w4-draft");
  const done = await newRecord(w, proj, actDone, "w4-done", "pass");
  const draft = await newRecord(w, proj, actDraft, "w4-draft", null);

  const comment = (c: SupabaseClient, record: string, body: string, extra: Record<string, unknown> = {}) =>
    c.from("inspection_comments").insert({ project_id: proj, inspection_record_id: record, body: `${MARK} ${body}`, ...extra });
  const row = async (id: string) =>
    (await w.admin.from("inspection_comments").select("body, author_id, resolved_at, resolved_by, edited_at, inspection_record_id").eq("id", id).maybeSingle()).data as {
      body: string;
      author_id: string;
      resolved_at: string | null;
      resolved_by: string | null;
      edited_at: string | null;
      inspection_record_id: string;
    } | null;

  g.refuseCall("a comment on an inspection that is not completed is refused", await comment(w.clientA.client, draft, "too early"));
  g.refuseCall("a user with no access to the project cannot comment", await comment(w.clientB.client, done, "outsider"));
  const outsiderRead = await w.clientB.client.from("inspection_comments").select("id").eq("project_id", proj);
  g.note("a user with no access to the project cannot read its comments", rowCount(outsiderRead) === 0 && !outsiderRead.error, `read returned ${show(outsiderRead)}`);

  const top = randomUUID();
  g.allowCall("a client user can comment on a completed inspection", await comment(w.clientA.client, done, "Please clarify the torque value", { id: top }), (await row(top))?.author_id === w.clientA.id);
  const forgedId = randomUUID();
  const forged = await comment(w.clientA.client, done, "forged author", { id: forgedId, author_id: w.adminG.id });
  g.note("a forged author_id is refused or overwritten with the caller", !!forged.error || (await row(forgedId))?.author_id === w.clientA.id, `author_id is ${(await row(forgedId))?.author_id}`);

  const reply = randomUUID();
  g.allowCall("staff can reply to a top-level comment", await comment(w.inspectorS.client, done, "Torque was 45 Nm", { id: reply, parent_id: top }));
  g.refuseCall("a reply to a reply is refused (threads are one level deep)", await comment(w.inspectorS.client, done, "nested", { parent_id: reply }));
  g.refuseCall("a reply must belong to the same inspection", await comment(w.inspectorS.client, draft, "wrong thread", { parent_id: top }));

  const edit = (c: SupabaseClient, id: string, patch: Record<string, unknown>) => c.from("inspection_comments").update(patch).eq("id", id).select("id");
  g.refuseRows("only the author can edit a comment (staff cannot rewrite a client's words)", await edit(w.inspectorS.client, top, { body: `${MARK} tampered` }), (await row(top))?.body === `${MARK} Please clarify the torque value`);
  g.allowRows("the author can edit within 15 minutes", await edit(w.clientA.client, top, { body: `${MARK} Please clarify the torque value (edited)` }), (await row(top))?.edited_at !== null);
  g.refuseRows("a client user cannot resolve a comment", await edit(w.clientA.client, top, { resolved_at: new Date().toISOString(), resolved_by: w.clientA.id }), (await row(top))?.resolved_at === null);
  g.refuseRows("a reply cannot be resolved", await edit(w.inspectorS.client, reply, { resolved_at: new Date().toISOString(), resolved_by: w.inspectorS.id }), (await row(reply))?.resolved_at === null);
  g.refuseRows("editing the body and resolving in one update is refused", await edit(w.inspectorS.client, reply, { body: `${MARK} both`, resolved_at: new Date().toISOString(), resolved_by: w.inspectorS.id }), (await row(reply))?.body === `${MARK} Torque was 45 Nm`);
  g.refuseRows("a comment cannot be moved to another inspection", await edit(w.clientA.client, top, { inspection_record_id: draft }), (await row(top))?.inspection_record_id === done);
  g.allowRows("JAGS staff can resolve a top-level comment", await edit(w.inspectorS.client, top, { resolved_at: new Date().toISOString(), resolved_by: w.inspectorS.id }), (await row(top))?.resolved_by === w.inspectorS.id);

  const del = await w.clientA.client.from("inspection_comments").delete().eq("id", top).select("id");
  g.refuseRows("nobody deletes a comment through the API (no DELETE policy, privilege revoked)", del, (await row(top)) !== null);
  const delStaff = await w.adminG.client.from("inspection_comments").delete().eq("id", reply).select("id");
  g.refuseRows("not even an Admin deletes a comment through the API", delStaff, (await row(reply)) !== null);

  // Edit window: backdate with the service role (which the trigger trusts), then try again as the author.
  await w.admin.from("inspection_comments").update({ created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() }).eq("id", top);
  g.refuseRows("the author cannot edit after 15 minutes", await edit(w.clientA.client, top, { body: `${MARK} late edit` }), (await row(top))?.body !== `${MARK} late edit`);
}

// ---------------------------------------------------------------------------------------------
// W5. ncrs (project_id, request_id) unique index (20261118000200)
// ---------------------------------------------------------------------------------------------

async function w5NcrRequestId(w: World): Promise<void> {
  w.checks.section("W5. ncrs unique request_id (20261118000200)");
  const g = guard(w, "ncrs_project_request_id_uidx");
  const projOne = await newProject(w, "w5a");
  const projTwo = await newProject(w, "w5b");
  const raise = (c: SupabaseClient, project: string, number: string, requestId?: string) =>
    c.from("ncrs").insert({
      id: randomUUID(),
      project_id: project,
      ncr_number: `${MARK}-${number}`,
      severity: "minor_ncr",
      description: `${MARK} request id test ${number}`,
      ...(requestId !== undefined ? { request_id: requestId } : {}),
    });
  const withKey = async (project: string, key: string) => ((await w.admin.from("ncrs").select("id").eq("project_id", project).eq("request_id", key)).data ?? []).length;

  g.allowCall("the first NCR raised with a request_id is created", await raise(w.clientA.client, projOne, "w5-1", "req-1"), (await withKey(projOne, "req-1")) === 1);
  const dup = await raise(w.clientA.client, projOne, "w5-2", "req-1");
  g.refuseCall("a second NCR with the same request_id in the same project is refused with 23505", dup, codeIs(dup, "23505") && (await withKey(projOne, "req-1")) === 1);
  g.refuseCall("a request_id longer than 64 characters is refused", await raise(w.clientA.client, projOne, "w5-3", "x".repeat(65)));
  g.allowCall("the same request_id is fine on a different project (the key is per project)", await raise(w.adminG.client, projTwo, "w5-4", "req-1"), (await withKey(projTwo, "req-1")) === 1);
  g.allowCall("NCRs without a request_id never collide", await raise(w.adminG.client, projTwo, "w5-5"));
  g.allowCall("... however many there are", await raise(w.adminG.client, projTwo, "w5-6"));
}

// ---------------------------------------------------------------------------------------------
// W6. ncrs_force_raised_by (20261102000300)
// ---------------------------------------------------------------------------------------------

async function w6NcrInsert(w: World): Promise<void> {
  w.checks.section("W6. ncrs_force_raised_by (20261102000300)");
  const g = guard(w, "ncrs_force_raised_by");
  const proj = await newProject(w, "w6");
  const other = await newProject(w, "w6-other");
  const otherAct = await newActivity(w, other, "w6-other");
  const otherRec = await newRecord(w, other, otherAct, "w6-other", "pass");

  const id = randomUUID();
  const forged = await w.clientA.client.from("ncrs").insert({
    id,
    project_id: proj,
    ncr_number: `${MARK}-NCR-w6-1`,
    severity: "minor_ncr",
    description: `${MARK} raised by the client with forged fields`,
    raised_by: w.adminG.id,
    status: "closed",
    closed_by: w.adminG.id,
    closed_at: new Date().toISOString(),
    reopen_count: 5,
  });
  const row = await ncrRow(w, id);
  g.allowCall("a client user can raise an NCR", forged, row?.status === "open");
  g.note("raised_by is forced to the caller, not the value sent", row?.raised_by === w.clientA.id, `raised_by is ${row?.raised_by}`);
  g.note("a new NCR always starts open with no closure stamps and a zero re-open count", row?.status === "open" && row.closed_by === null && row.closed_at === null && row.reopen_count === 0, JSON.stringify(row));

  g.refuseCall(
    "an ITP item of another project cannot be linked",
    await w.clientA.client.from("ncrs").insert({ id: randomUUID(), project_id: proj, ncr_number: `${MARK}-NCR-w6-2`, severity: "minor_ncr", description: `${MARK} foreign ITP link`, itp_item_id: otherAct.itemId })
  );
  g.refuseCall(
    "an inspection of another project cannot be linked",
    await w.clientA.client.from("ncrs").insert({ id: randomUUID(), project_id: proj, ncr_number: `${MARK}-NCR-w6-3`, severity: "minor_ncr", description: `${MARK} foreign inspection link`, inspection_record_id: otherRec })
  );
}

// ---------------------------------------------------------------------------------------------
// W7. ncrs_enforce_workflow + ncr_evidence_write_guard (20261102000300)
// ---------------------------------------------------------------------------------------------

async function w7NcrWorkflow(w: World): Promise<void> {
  w.checks.section("W7. ncrs_enforce_workflow + ncr_evidence_write_guard (20261102000300)");
  const g = guard(w, "ncrs_enforce_workflow");
  const ge = guard(w, "ncr_evidence_write_guard");
  const proj = await newProject(w, "w7");
  const n = randomUUID();
  must(
    "w7 ncr raised by the client",
    await w.clientA.client.from("ncrs").insert({ id: n, project_id: proj, ncr_number: `${MARK}-NCR-w7-1`, severity: "minor_ncr", description: `${MARK} workflow test NCR` }).select("id").single()
  );
  const upd = (c: SupabaseClient, patch: Record<string, unknown>) => c.from("ncrs").update(patch).eq("id", n).select("id");
  const photo = (c: SupabaseClient, name: string, dir = `${proj}/ncrs/${n}`) => c.from("ncr_photos").insert({ ncr_id: n, storage_path: `${dir}/${name}` });
  const status = async () => (await ncrRow(w, n))?.status;

  g.allowRows("the raiser can start work (open -> in_progress)", await upd(w.clientA.client, { status: "in_progress" }), (await status()) === "in_progress");
  g.refuseRows("a non-staff raiser cannot change the severity", await upd(w.clientA.client, { severity: "major_ncr" }), (await ncrRow(w, n))?.severity === "minor_ncr");
  g.refuseRows("cannot be sent for verification without root cause / corrective / preventive action", await upd(w.clientA.client, { status: "pending_verification" }), (await status()) === "in_progress");
  g.allowRows("the raiser can record the CAPA text", await upd(w.clientA.client, { root_cause: "rc", corrective_action: "ca", preventive_action: "pa" }), (await ncrRow(w, n))?.root_cause === "rc");
  g.refuseRows("cannot be sent for verification without evidence", await upd(w.clientA.client, { status: "pending_verification" }), (await status()) === "in_progress");
  g.refuseRows("a project user who does not work the NCR cannot edit its CAPA text", await upd(w.contractorC.client, { root_cause: "hijack" }), (await ncrRow(w, n))?.root_cause === "rc");

  ge.refuseCall("a project user who does not work the NCR cannot attach evidence", await photo(w.contractorC.client, "a.jpg"));
  ge.refuseCall("evidence must live under {project}/ncrs/{ncr}/", await photo(w.clientA.client, "a.jpg", `${proj}/other`));
  ge.allowCall("the raiser can attach evidence under the NCR's own folder", await photo(w.clientA.client, "a.jpg"));

  g.allowRows("with CAPA text and evidence the raiser sends it for verification", await upd(w.clientA.client, { status: "pending_verification" }), (await status()) === "pending_verification");
  g.refuseRows("the CAPA text is locked while the NCR awaits verification", await upd(w.clientA.client, { root_cause: "changed" }), (await ncrRow(w, n))?.root_cause === "rc");
  ge.refuseCall("evidence is locked while the NCR awaits verification", await photo(w.clientA.client, "b.jpg"));

  g.refuseRows("the raiser cannot close their own NCR", await upd(w.clientA.client, { status: "closed", verification_notes: "ok" }), (await status()) === "pending_verification");
  g.refuseRows("an Inspector without the close_ncr permission cannot close it", await upd(w.inspectorS.client, { status: "closed", verification_notes: "Verified on site" }), (await status()) === "pending_verification");
  g.refuseRows("even an Admin cannot close without verification notes", await upd(w.adminG.client, { status: "closed" }), (await status()) === "pending_verification");
  const closed = await upd(w.adminG.client, { status: "closed", verification_notes: "Verified on site" });
  const afterClose = await ncrRow(w, n);
  g.allowRows("an Admin closes it (closer and time stamped by the database)", closed, afterClose?.status === "closed" && afterClose.closed_by === w.adminG.id && afterClose.closed_at !== null);

  g.refuseRows("a closed NCR cannot be edited, even by an Admin", await upd(w.adminG.client, { description: `${MARK} edited after the close` }), (await status()) === "closed");
  ge.refuseCall("evidence cannot be added to a closed NCR", await photo(w.clientA.client, "c.jpg"));
  g.refuseRows("a client user cannot re-open a closed NCR", await upd(w.clientA.client, { status: "in_progress" }), (await status()) === "closed");
  g.refuseRows("an Inspector without close_ncr cannot re-open a closed NCR", await upd(w.inspectorS.client, { status: "in_progress" }), (await status()) === "closed");
  const reopened = await upd(w.adminG.client, { status: "in_progress" });
  const afterReopen = await ncrRow(w, n);
  g.allowRows("an Admin can re-open a closed NCR (closure stamps cleared)", reopened, afterReopen?.status === "in_progress" && afterReopen.closed_by === null && afterReopen.closed_at === null);
  g.refuseRows("states cannot be skipped (in_progress -> closed)", await upd(w.adminG.client, { status: "closed", verification_notes: "x" }), (await status()) === "in_progress");
}

// ---------------------------------------------------------------------------------------------
// W8. ncrs_guard_delete + ncrs delete policy (20261016S50001)
// ---------------------------------------------------------------------------------------------

async function w8NcrDelete(w: World): Promise<void> {
  w.checks.section("W8. ncrs_guard_delete + ncrs delete policy (20261016S50001)");
  const g = guard(w, "ncrs_guard_delete", "ncrs");
  const proj = await newProject(w, "w8");
  const open = randomUUID();
  const closedNcr = randomUUID();
  must("w8 open ncr", await w.admin.from("ncrs").insert({ id: open, project_id: proj, ncr_number: `${MARK}-NCR-w8-1`, severity: "minor_ncr", description: `${MARK} open NCR to delete` }).select("id").single());
  must(
    "w8 closed ncr",
    await w.admin
      .from("ncrs")
      .insert({
        id: closedNcr,
        project_id: proj,
        ncr_number: `${MARK}-NCR-w8-2`,
        severity: "minor_ncr",
        description: `${MARK} closed NCR that must stay`,
        status: "closed",
        root_cause: "r",
        corrective_action: "c",
        preventive_action: "p",
        verification_notes: "v",
        closed_at: new Date().toISOString(),
      })
      .select("id")
      .single()
  );
  const exists = async (id: string) => (await ncrRow(w, id)) !== null;
  const del = (c: SupabaseClient, id: string) => c.from("ncrs").delete().eq("id", id).select("id");

  g.refuseRows("a project-scoped Inspector cannot delete an NCR", await del(w.inspectorS.client, open), await exists(open));
  g.refuseRows("a client user cannot delete an NCR (even one they could see)", await del(w.clientA.client, open), await exists(open));
  g.refuseRows("not even an Admin can delete a closed NCR", await del(w.adminG.client, closedNcr), await exists(closedNcr));
  g.allowRows("an Admin can delete an open NCR", await del(w.adminG.client, open), !(await exists(open)));
}

// ---------------------------------------------------------------------------------------------
// W9. punch list guards (20261102000400, 20261110000100, 20261102000200)
// ---------------------------------------------------------------------------------------------

async function w9Punch(w: World): Promise<void> {
  w.checks.section("W9. punch_list_items guards (20261102000400, 20261110000100)");
  const gi = guard(w, "punch_list_items_guard_insert", "punch_list_items");
  const gt = guard(w, "punch_list_items_guard_transition");
  const gr = guard(w, "punch_reopen_ncr_closed_guard");
  const gu = guard(w, "punch_list_items_request_uidx");
  const proj = await newProject(w, "w9");
  const create = (c: SupabaseClient, over: Record<string, unknown> = {}) =>
    c.from("punch_list_items").insert({ id: randomUUID(), project_id: proj, description: `${MARK} punch item`, source: "manual", ...over });
  const state = async (id: string) =>
    (await w.admin.from("punch_list_items").select("status, created_by, closed_by, resolved_by, closing_evidence").eq("id", id).maybeSingle()).data as {
      status: string;
      created_by: string | null;
      closed_by: string | null;
      resolved_by: string | null;
      closing_evidence: string | null;
    } | null;
  const upd = (c: SupabaseClient, id: string, patch: Record<string, unknown>) => c.from("punch_list_items").update(patch).eq("id", id).select("id");

  gi.refuseCall("a punch item cannot be created already closed", await create(w.clientA.client, { status: "closed" }));
  gi.refuseCall("a punch item cannot link an NCR that is not in this project", await create(w.clientA.client, { source: "ncr", source_ncr_id: randomUUID() }));
  const pid = randomUUID();
  gi.allowCall("a client user can add an open punch item (creator forced to the caller)", await create(w.clientA.client, { id: pid, created_by: w.adminG.id }), (await state(pid))?.created_by === w.clientA.id);

  gt.refuseRows("a client user cannot mark an item resolved", await upd(w.clientA.client, pid, { status: "resolved", closing_evidence: "fixed" }), (await state(pid))?.status === "open");
  gt.refuseRows("a client user cannot change an item's priority", await upd(w.clientA.client, pid, { priority: "A" }), true);
  gt.refuseRows("resolving needs written evidence of what was done", await upd(w.inspectorS.client, pid, { status: "resolved" }), (await state(pid))?.status === "open");
  gt.allowRows("JAGS staff can resolve an item with evidence", await upd(w.inspectorS.client, pid, { status: "resolved", closing_evidence: "Replaced the tile" }), (await state(pid))?.status === "resolved");
  gt.refuseRows("an Inspector without close_punch_item cannot close it", await upd(w.inspectorS.client, pid, { status: "closed", verification_notes: "ok" }), (await state(pid))?.status === "resolved");
  gt.refuseRows("closing needs verification notes", await upd(w.adminG.client, pid, { status: "closed" }), (await state(pid))?.status === "resolved");
  gt.allowRows("an Admin (a different person from the resolver) can close it", await upd(w.adminG.client, pid, { status: "closed", verification_notes: "Checked on site" }), (await state(pid))?.status === "closed");
  gt.refuseRows("closing evidence cannot be edited once closed", await upd(w.adminG.client, pid, { closing_evidence: "changed" }), (await state(pid))?.closing_evidence === "Replaced the tile");
  gt.refuseRows("an Inspector without close_punch_item cannot re-open a closed item", await upd(w.inspectorS.client, pid, { status: "open" }), (await state(pid))?.status === "closed");
  gt.allowRows("an Admin can re-open a closed item", await upd(w.adminG.client, pid, { status: "open" }), (await state(pid))?.status === "open");
  gt.allowRows("an Admin resolves it again", await upd(w.adminG.client, pid, { status: "resolved", closing_evidence: "Replaced again" }), (await state(pid))?.status === "resolved");
  gt.refuseRows("the same person cannot resolve and then close an item", await upd(w.adminG.client, pid, { status: "closed", verification_notes: "Checked" }), (await state(pid))?.status === "resolved");
  gt.allowRows("a second Admin can close it", await upd(w.adminH.client, pid, { status: "closed", verification_notes: "Checked by the second admin" }), (await state(pid))?.status === "closed");
  gi.refuseRows("a client user cannot delete a punch item", await w.clientA.client.from("punch_list_items").delete().eq("id", pid).select("id"), (await state(pid)) !== null);

  // The NCR-sourced item cannot be re-opened while its NCR is still closed.
  const ncr = randomUUID();
  must(
    "w9 closed ncr",
    await w.admin
      .from("ncrs")
      .insert({ id: ncr, project_id: proj, ncr_number: `${MARK}-NCR-w9-1`, severity: "minor_ncr", description: `${MARK} closed NCR with a punch item`, status: "closed", root_cause: "r", corrective_action: "c", preventive_action: "p", verification_notes: "v", closed_at: new Date().toISOString() })
      .select("id")
      .single()
  );
  const sourced = randomUUID();
  must(
    "w9 ncr-sourced punch item",
    await w.admin
      .from("punch_list_items")
      .insert({ id: sourced, project_id: proj, description: `${MARK} item from a closed NCR`, source: "ncr", source_ncr_id: ncr, status: "closed", closed_by: w.adminG.id, closed_at: new Date().toISOString(), verification_notes: "Verified" })
      .select("id")
      .single()
  );
  const blocked = await upd(w.adminG.client, sourced, { status: "open" });
  gr.refuseRows("an NCR-sourced punch item cannot be re-opened while its NCR is closed (23514)", blocked, codeIs(blocked, "23514") && (await state(sourced))?.status === "closed");
  must("w9 reopen ncr", await w.adminG.client.from("ncrs").update({ status: "in_progress" }).eq("id", ncr).select("id").single());
  gr.allowRows("once the NCR is re-opened the punch item can be re-opened", await upd(w.adminG.client, sourced, { status: "open" }), (await state(sourced))?.status === "open");

  // Offline replay key: unique per project.
  gu.allowCall("a punch item created with a client_request_id", await create(w.clientA.client, { client_request_id: "punch-req-1" }));
  const dup = await create(w.clientA.client, { client_request_id: "punch-req-1" });
  gu.refuseCall("the same client_request_id in the same project is refused with 23505", dup, codeIs(dup, "23505"));
}

// ---------------------------------------------------------------------------------------------
// W10. irns_write_guard + irns_issue_gates_guard + irns_project_number_key (20261017S60001, 20261102000500)
// ---------------------------------------------------------------------------------------------

async function w10Irns(w: World): Promise<void> {
  w.checks.section("W10. IRN guards (20261017S60001, 20261102000500)");
  const g = guard(w, "irns_write_guard", "irns");
  const gg = guard(w, "irns_issue_gates_guard");
  const gn = guard(w, "irns_project_number_key");
  const proj = await newProject(w, "w10");
  const [a1, a2, a3, a4] = await Promise.all(["w10-1", "w10-2", "w10-3", "w10-4"].map((l) => newActivity(w, proj, l)));
  const rec1 = await newRecord(w, proj, a1, "w10-1", "pass");
  const rec2 = await newRecord(w, proj, a2, "w10-2", "pass");
  const recDraft = await newRecord(w, proj, a3, "w10-3", null);
  const recGate = await newRecord(w, proj, a4, "w10-4", "pass");

  const issue = (c: SupabaseClient, rec: string, number: string, extra: Record<string, unknown> = {}) =>
    c.from("irns").insert({ id: randomUUID(), inspection_record_id: rec, irn_number: `${MARK}-${number}`, ...extra });
  const irn = async (id: string) => (await w.admin.from("irns").select("issued_by, voided_at, voided_by, void_reason, project_id, irn_number").eq("id", id).maybeSingle()).data as {
    issued_by: string | null;
    voided_at: string | null;
    voided_by: string | null;
    void_reason: string | null;
    project_id: string | null;
    irn_number: string;
  } | null;

  g.refuseCall("a client user cannot issue an IRN", await issue(w.clientA.client, rec1, "IRN-1"));
  g.refuseCall("a project user who is not assigned to the activity cannot issue an IRN", await issue(w.contractorC.client, rec1, "IRN-1"));
  g.refuseCall("no IRN can be issued from an inspection that is not completed", await issue(w.inspectorS.client, recDraft, "IRN-D"));

  const id1 = randomUUID();
  const issued = await issue(w.inspectorS.client, rec1, "IRN-1", { id: id1, issued_by: w.adminG.id, voided_at: new Date().toISOString(), void_reason: "pre-voided" });
  const row1 = await irn(id1);
  g.allowCall("JAGS staff can issue an IRN from a passed inspection", issued, row1?.issued_by === w.inspectorS.id && row1.voided_at === null && row1.void_reason === null && row1.project_id === proj);

  const dup = await issue(w.inspectorS.client, rec2, "IRN-1");
  gn.refuseCall("another IRN with the same number in the project is refused with 23505", dup, codeIs(dup, "23505"));
  gn.allowCall("a different number on another passed inspection is fine", await issue(w.inspectorS.client, rec2, "IRN-2"));

  const upd = (c: SupabaseClient, patch: Record<string, unknown>) => c.from("irns").update(patch).eq("id", id1).select("id");
  g.refuseRows("an issued IRN's number cannot be changed", await upd(w.inspectorS.client, { irn_number: `${MARK}-IRN-X` }), (await irn(id1))?.irn_number === `${MARK}-IRN-1`);
  g.refuseRows("voiding needs a reason", await upd(w.inspectorS.client, { voided_at: new Date().toISOString() }), (await irn(id1))?.voided_at === null);
  g.refuseRows("a client user cannot void an IRN", await upd(w.clientA.client, { voided_at: new Date().toISOString(), void_reason: "no" }), (await irn(id1))?.voided_at === null);
  g.refuseRows("an IRN cannot be deleted by staff", await w.inspectorS.client.from("irns").delete().eq("id", id1).select("id"), (await irn(id1)) !== null);
  g.refuseRows("an IRN cannot be deleted even by an Admin", await w.adminG.client.from("irns").delete().eq("id", id1).select("id"), (await irn(id1)) !== null);
  g.allowRows("JAGS staff can void an IRN with a reason (voider stamped by the database)", await upd(w.inspectorS.client, { voided_at: new Date().toISOString(), void_reason: "Issued in error" }), (await irn(id1))?.voided_by === w.inspectorS.id);
  g.refuseRows("a voided IRN cannot be reinstated", await upd(w.inspectorS.client, { voided_at: null, void_reason: null, voided_by: null }), (await irn(id1))?.voided_at !== null);

  // Issue gate: no IRN while an NCR raised from the inspection is open (observations never block).
  const ncr = randomUUID();
  must("w10 gate ncr", await w.admin.from("ncrs").insert({ id: ncr, project_id: proj, ncr_number: `${MARK}-NCR-w10-1`, severity: "minor_ncr", description: `${MARK} NCR raised from the inspection`, inspection_record_id: recGate }).select("id").single());
  gg.refuseCall("an IRN is refused while an NCR raised from the inspection is still open", await issue(w.inspectorS.client, recGate, "IRN-G"));
  await w.admin.from("ncrs").update({ severity: "observation" }).eq("id", ncr);
  gg.allowCall("an open observation does not block the IRN", await issue(w.inspectorS.client, recGate, "IRN-G"));
}

// ---------------------------------------------------------------------------------------------
// W11. data_books_guard + data book policies + one-open-book index (20261101000100)
// ---------------------------------------------------------------------------------------------

async function w11DataBooks(w: World): Promise<void> {
  w.checks.section("W11. data_books_guard + policies (20261101000100)");
  const g = guard(w, "data_books_guard", "data_books");
  const gu = guard(w, "data_books_one_open_per_project_uidx", "data_books_project_revision_uidx");
  const proj = await newProject(w, "w11");
  const book = randomUUID();
  must("w11 book", await w.admin.from("data_books").insert({ id: book, project_id: proj, book_number: `${MARK}-DB-w11-1`, title: `${MARK} data book` }).select("id").single());
  const bookState = async (id: string) => (await w.admin.from("data_books").select("status, revision, override_reason").eq("id", id).maybeSingle()).data as { status: string; revision: number; override_reason: string | null } | null;
  const compile = (c: SupabaseClient, id: string, override: boolean, reason: string | null) =>
    c.rpc("compile_data_book", { p_data_book_id: id, p_override: override, p_override_reason: reason, p_override_items: [] });
  const withdraw = (c: SupabaseClient, id: string, reason: string) => c.rpc("withdraw_data_book", { p_data_book_id: id, p_reason: reason });
  const upd = (c: SupabaseClient, id: string, patch: Record<string, unknown>) => c.from("data_books").update(patch).eq("id", id).select("id");

  g.refuseCall("a client user cannot create a Data Book", await w.clientA.client.from("data_books").insert({ project_id: proj, book_number: `${MARK}-DB-w11-c`, title: `${MARK} by client` }));
  g.refuseCall("a Data Book cannot be created already compiled", await w.inspectorS.client.from("data_books").insert({ project_id: proj, book_number: `${MARK}-DB-w11-x`, title: `${MARK} compiled at birth`, status: "compiled" }));
  const second = await w.inspectorS.client.from("data_books").insert({ project_id: proj, book_number: `${MARK}-DB-w11-2`, title: `${MARK} second open book` });
  gu.refuseCall("a second non-issued Data Book on the project is refused with 23505 (the open-book and revision indexes both bar it)", second, codeIs(second, "23505"));
  const otherProj = await newProject(w, "w11-other");
  gu.allowCall("each project may have its own open Data Book", await w.inspectorS.client.from("data_books").insert({ project_id: otherProj, book_number: `${MARK}-DB-w11-o`, title: `${MARK} other project's book` }));
  g.refuseRows("a draft cannot be compiled by a direct status update", await upd(w.inspectorS.client, book, { status: "compiled" }), (await bookState(book))?.status === "draft");
  g.refuseRows("a draft cannot be issued by a direct status update", await upd(w.inspectorS.client, book, { status: "issued" }), (await bookState(book))?.status === "draft");
  g.refuseCall("compile_data_book refuses a project that is not completed", await compile(w.inspectorS.client, book, false, null), (await bookState(book))?.status === "draft");
  g.refuseCall("only an Admin can compile with an override", await compile(w.inspectorS.client, book, true, "Client agreed to compile early"), (await bookState(book))?.status === "draft");
  g.refuseCall("a client user cannot compile a Data Book", await compile(w.clientA.client, book, true, "Client agreed to compile early"), (await bookState(book))?.status === "draft");
  g.refuseCall("an override needs a reason of at least 10 characters", await compile(w.adminG.client, book, true, "short"), (await bookState(book))?.status === "draft");
  g.allowCall("an Admin compiles with a written override reason", await compile(w.adminG.client, book, true, "Client agreed to compile early"), (await bookState(book))?.status === "compiled");
  g.refuseRows("a compiled book's override details cannot be edited", await upd(w.inspectorS.client, book, { override_reason: "edited" }), (await bookState(book))?.override_reason === "Client agreed to compile early");
  g.refuseRows("a compiled book cannot be returned to draft by a direct update", await upd(w.inspectorS.client, book, { status: "draft" }), (await bookState(book))?.status === "compiled");
  g.refuseCall("only an Admin can withdraw a compiled book", await withdraw(w.inspectorS.client, book, "Compiled by mistake today"), (await bookState(book))?.status === "compiled");
  g.refuseCall("withdrawing needs a reason of at least 10 characters", await withdraw(w.adminG.client, book, "short"), (await bookState(book))?.status === "compiled");
  g.allowCall("an Admin withdraws a compiled book back to draft", await withdraw(w.adminG.client, book, "Compiled by mistake today"), (await bookState(book))?.status === "draft");
  g.refuseRows("the revision number is immutable", await upd(w.adminG.client, book, { revision: 9 }), (await bookState(book))?.revision === 0);
  g.refuseRows("an Inspector cannot delete a Data Book", await w.inspectorS.client.from("data_books").delete().eq("id", book).select("id"), (await bookState(book)) !== null);
  g.allowRows("an Admin can delete a draft Data Book", await w.adminG.client.from("data_books").delete().eq("id", book).select("id"), (await bookState(book)) === null);

  // Ready project: completed, nothing open -> staff can compile without an override.
  const ready = randomUUID();
  must("w11 ready book", await w.admin.from("data_books").insert({ id: ready, project_id: proj, book_number: `${MARK}-DB-w11-3`, title: `${MARK} ready book` }).select("id").single());
  await w.admin.from("projects").update({ status: "completed" }).eq("id", proj);
  g.allowCall("staff can compile without an override once the project is completed and clean", await compile(w.inspectorS.client, ready, false, null), (await bookState(ready))?.status === "compiled");
}

// ---------------------------------------------------------------------------------------------
// W12. execution guards: start / answer / complete / re-open / sign off (20261015S40001, 20261102000500, 20261110000100, 20261106000100)
// ---------------------------------------------------------------------------------------------

async function w12Execution(w: World): Promise<void> {
  w.checks.section("W12. inspection execution guards (20261015S40001, 20261102000500, 20261110000100, 20261106000100)");
  const ge = guard(w, "inspection_records_exec_guard");
  const gc = guard(w, "inspection_child_exec_guard", "inspection_child_write_guard");
  const gw = guard(w, "inspection_records_write_guard", "inspection_records");
  const gcw = guard(w, "inspection_child_write_guard");
  const gam = guard(w, "inspection_amendment_authority_guard");
  const gs = guard(w, "activity_signoff_progress_guard");
  const gf = guard(w, "checklist_items_freeze_guard");
  const gt = guard(w, "checklist_templates_delete_guard");

  const proj = await newProject(w, "w12");
  const act = await newActivity(w, proj, "w12");
  const spare = await newActivity(w, proj, "w12-spare");
  // The contractor fixture is the subcontractor party assigned to the activity.
  const party = must("w12 party", await w.admin.from("project_parties").insert({ project_id: proj, party_type: "subcontractor", name: `${MARK} Sub Co`, user_id: w.contractorC.id }).select("id").single());
  must("w12 activity party", await w.admin.from("activity_party_intervention").insert({ itp_item_id: act.itemId, project_party_id: party.id, intervention: "R" }).select("id").single());

  const SIG = "data:image/png;base64,AAAA";
  const NO_EVIDENCE = "[No evidence attached: nothing to photograph]";
  const rec = randomUUID();
  const start = (c: SupabaseClient, id: string, extra: Record<string, unknown> = {}) =>
    c.from("inspection_records").insert({
      id,
      project_id: proj,
      itp_item_id: act.itemId,
      checklist_template_id: act.templateId,
      record_number: `${MARK}-INSP-w12-${id.slice(0, 8)}`,
      project_name: `${MARK} project`,
      itp_number: act.itpNumber,
      activity: `${MARK} activity`,
      ...extra,
    });
  const recState = async () => (await w.admin.from("inspection_records").select("inspector_id, signed_by_user_id, overall_result, notes").eq("id", rec).maybeSingle()).data as {
    inspector_id: string | null;
    signed_by_user_id: string | null;
    overall_result: string | null;
    notes: string | null;
  } | null;
  const updRec = (c: SupabaseClient, patch: Record<string, unknown>) => c.from("inspection_records").update(patch).eq("id", rec).select("id");
  const answers = () => w.admin.from("checklist_responses").select("result").eq("inspection_record_id", rec);

  ge.refuseCall("a client user who is not assigned to the activity cannot start an inspection", await start(w.clientA.client, randomUUID()));
  ge.refuseCall("an inspection cannot be created already completed", await start(w.contractorC.client, randomUUID(), { overall_result: "pass" }));
  const started = await start(w.contractorC.client, rec, { inspector_id: w.adminG.id });
  ge.allowCall("the assigned subcontractor can start an inspection (inspector_id forced to the caller)", started, (await recState())?.inspector_id === w.contractorC.id);

  const answer = (c: SupabaseClient, itemId: string) => c.from("checklist_responses").insert({ inspection_record_id: rec, checklist_item_id: itemId, result: "yes" });
  gc.refuseCall("an answer must point at an item of this inspection's checklist", await answer(w.contractorC.client, randomUUID()));
  gc.allowCall("the assigned subcontractor can answer a checklist item", await answer(w.contractorC.client, act.checklistItemId), ((await answers()).data ?? []).length === 1);
  gc.refuseRows("a client user who is not assigned cannot change an answer", await w.clientA.client.from("checklist_responses").update({ result: "no" }).eq("inspection_record_id", rec).select("id"), ((await answers()).data ?? [])[0]?.result === "yes");

  ge.refuseRows("a client user cannot complete the inspection", await updRec(w.clientA.client, { overall_result: "pass", inspector_signature: SIG, notes: NO_EVIDENCE }), (await recState())?.overall_result === null);
  ge.refuseRows("completion needs a signature", await updRec(w.contractorC.client, { overall_result: "pass", notes: NO_EVIDENCE }), (await recState())?.overall_result === null);
  ge.refuseRows("completion needs evidence (a photo, a linked document or the written no-evidence reason)", await updRec(w.contractorC.client, { overall_result: "pass", inspector_signature: SIG }), (await recState())?.overall_result === null);
  ge.refuseRows("the overall result must match the recorded answers", await updRec(w.contractorC.client, { overall_result: "fail", inspector_signature: SIG, notes: NO_EVIDENCE }), (await recState())?.overall_result === null);
  const completed = await updRec(w.contractorC.client, { overall_result: "pass", inspector_signature: SIG, notes: NO_EVIDENCE });
  ge.allowRows("the assigned subcontractor completes it (signer stamped by the database)", completed, (await recState())?.overall_result === "pass" && (await recState())?.signed_by_user_id === w.contractorC.id);

  gcw.refuseRows("answers are frozen once the inspection is completed", await w.contractorC.client.from("checklist_responses").update({ result: "no" }).eq("inspection_record_id", rec).select("id"), ((await answers()).data ?? [])[0]?.result === "yes");
  gw.refuseRows("a completed inspection cannot be edited", await updRec(w.contractorC.client, { notes: "rewritten" }), (await recState())?.notes === NO_EVIDENCE);
  gw.refuseRows("the executing party cannot re-open a completed inspection", await updRec(w.contractorC.client, { overall_result: null }), (await recState())?.overall_result === "pass");
  gw.refuseRows("a completed inspection cannot be deleted by the party", await w.contractorC.client.from("inspection_records").delete().eq("id", rec).select("id"), (await recState()) !== null);
  gw.refuseRows("a completed inspection cannot be deleted by staff either", await w.inspectorS.client.from("inspection_records").delete().eq("id", rec).select("id"), (await recState()) !== null);

  // Re-opening is a controlled amendment.
  const amend = (c: SupabaseClient) => c.from("inspection_record_amendments").insert({ record_id: rec, reason: `${MARK} re-open for rework` });
  gam.refuseCall("a client user cannot record an amendment (re-open)", await amend(w.clientA.client));
  gam.refuseCall("an Inspector who is not a team lead on the project cannot record an amendment", await amend(w.inspectorS.client));
  gam.allowCall("an Admin can record an amendment", await amend(w.adminG.client));

  // Sign-off progress for the same activity.
  let progress = (await w.admin.from("activity_signoff_progress").select("id, status").eq("itp_item_id", act.itemId).eq("project_party_id", party.id).maybeSingle()).data as { id: string; status: string } | null;
  if (!progress) {
    progress = must("w12 signoff row", await w.admin.from("activity_signoff_progress").insert({ itp_item_id: act.itemId, project_party_id: party.id, intervention: "R", status: "pending" }).select("id, status").single()) as { id: string; status: string };
  }
  const progressId = progress.id;
  const signState = async () => (await w.admin.from("activity_signoff_progress").select("status").eq("id", progressId).single()).data?.status as string;
  const sign = (c: SupabaseClient, status: string) => c.from("activity_signoff_progress").update({ status }).eq("id", progressId).select("id");
  gs.refuseRows("a client user cannot sign off for the party", await sign(w.clientA.client, "signed_off"), (await signState()) !== "signed_off");
  gs.refuseRows("an Inspector who is neither the party, an admin nor a team lead cannot sign off", await sign(w.inspectorS.client, "signed_off"), (await signState()) !== "signed_off");
  gs.allowRows("the linked party's own login can sign off", await sign(w.contractorC.client, "signed_off"), (await signState()) === "signed_off");
  gs.refuseRows("the party cannot withdraw its own recorded sign-off", await sign(w.contractorC.client, "pending"), (await signState()) === "signed_off");
  gs.refuseRows("an Inspector who is not an admin or team lead cannot withdraw a sign-off", await sign(w.inspectorS.client, "pending"), (await signState()) === "signed_off");
  gs.allowRows("an Admin can withdraw a recorded sign-off", await sign(w.adminG.client, "pending"), (await signState()) === "pending");
  gs.allowRows("an Admin can sign off on behalf of the party", await sign(w.adminG.client, "signed_off"), (await signState()) === "signed_off");

  // Checklist freeze / template delete: the used checklist is frozen, an unused one is not.
  gf.refuseRows("a checklist item cannot be edited once responses exist", await w.inspectorS.client.from("checklist_items").update({ description: `${MARK} changed` }).eq("id", act.checklistItemId).select("id"), true);
  gf.refuseRows("a checklist item cannot be deleted once responses exist", await w.inspectorS.client.from("checklist_items").delete().eq("id", act.checklistItemId).select("id"), true);
  gt.refuseRows("a checklist with inspection records cannot be deleted (archive it)", await w.inspectorS.client.from("checklist_templates").delete().eq("id", act.templateId).select("id"), true);
  gf.allowRows("an unused checklist's items can still be edited by staff", await w.inspectorS.client.from("checklist_items").update({ description: `${MARK} reworded` }).eq("id", spare.checklistItemId).select("id"));
  gt.allowRows("an unused checklist can be deleted by staff", await w.inspectorS.client.from("checklist_templates").delete().eq("id", spare.templateId).select("id"));

  // Staff re-open, then discard the open draft (the only delete the policy allows).
  gw.allowRows("JAGS staff can re-open a completed inspection (result cleared)", await updRec(w.inspectorS.client, { overall_result: null }), (await recState())?.overall_result === null);
  gw.allowRows("JAGS staff can discard an open draft inspection", await w.inspectorS.client.from("inspection_records").delete().eq("id", rec).select("id"), (await recState()) === null);
}

// ---------------------------------------------------------------------------------------------
// W13. standalone assignment guards (20261015S40002, 20261102000100)
// ---------------------------------------------------------------------------------------------

async function w13Standalone(w: World): Promise<void> {
  w.checks.section("W13. standalone assignment guards (20261015S40002, 20261102000100)");
  const g = guard(w, "standalone_assignments_lifecycle_guard", "standalone_assignments");
  const gc = guard(w, "standalone_child_write_guard");
  const gk = guard(w, "standalone_assignment_measurements_client_key_uidx");
  const proj = await newProject(w, "w13");
  const sa = randomUUID();
  const create = (c: SupabaseClient, id: string, extra: Record<string, unknown> = {}) =>
    c.from("standalone_assignments").insert({ id, project_id: proj, assignment_number: `${MARK}-SA-${id.slice(0, 8)}`, assignment_type: "fat", equipment_description: `${MARK} pump`, ...extra });
  const state = async () => (await w.admin.from("standalone_assignments").select("status, conclusion, equipment_description, narrative").eq("id", sa).maybeSingle()).data as { status: string; conclusion: string | null; equipment_description: string; narrative: string | null } | null;
  const upd = (c: SupabaseClient, patch: Record<string, unknown>) => c.from("standalone_assignments").update(patch).eq("id", sa).select("id");
  const measure = (c: SupabaseClient, extra: Record<string, unknown> = {}) => c.from("standalone_assignment_measurements").insert({ assignment_id: sa, description: `${MARK} flow`, ...extra });

  g.refuseCall("a client user cannot create a standalone assignment", await create(w.clientA.client, randomUUID()));
  g.refuseCall("a new assignment cannot start completed", await create(w.inspectorS.client, randomUUID(), { status: "completed" }));
  g.allowCall("JAGS staff can create a draft assignment", await create(w.inspectorS.client, sa), (await state())?.status === "draft");
  gc.allowCall("measurements can be added while the assignment is a draft", await measure(w.inspectorS.client));
  gk.allowCall("an offline measurement with a client_key is stored once", await measure(w.inspectorS.client, { client_key: "offline-key-1" }));
  const dup = await measure(w.inspectorS.client, { client_key: "offline-key-1" });
  gk.refuseCall("the same client_key replayed for the same assignment is refused with 23505", dup, codeIs(dup, "23505"));

  g.refuseRows("the conclusion cannot change without a finalize", await upd(w.inspectorS.client, { conclusion: "pass" }), (await state())?.conclusion === null);
  g.allowRows("staff can finalize a draft (draft -> completed with a conclusion)", await upd(w.inspectorS.client, { status: "completed", conclusion: "pass" }), (await state())?.status === "completed");
  g.refuseRows("a completed assignment is locked", await upd(w.inspectorS.client, { equipment_description: `${MARK} edited` }), (await state())?.equipment_description === `${MARK} pump`);
  g.allowRows("staff can still edit the report narrative of a completed assignment", await upd(w.inspectorS.client, { narrative: "Report text" }), (await state())?.narrative === "Report text");
  gc.refuseCall("measurements cannot be added to a completed assignment", await measure(w.inspectorS.client));
  g.refuseRows("an Inspector cannot re-open a completed assignment", await upd(w.inspectorS.client, { status: "draft" }), (await state())?.status === "completed");
  g.refuseRows("a completed assignment cannot be deleted", await w.inspectorS.client.from("standalone_assignments").delete().eq("id", sa).select("id"), (await state()) !== null);
  g.allowRows("an Admin can re-open a completed assignment", await upd(w.adminG.client, { status: "draft" }), (await state())?.status === "draft");
}

// ---------------------------------------------------------------------------------------------
// W14. vault document guards + ITP lifecycle guards (20261017S60002, 20261101000200, 20261123000300, 20261103000200, 20261107000100)
// ---------------------------------------------------------------------------------------------

async function w14VaultAndItp(w: World): Promise<void> {
  w.checks.section("W14. vault document and ITP lifecycle guards (20261017S60002, 20261101000200, 20261123000300, 20261103000200, 20261107000100)");
  const gi = guard(w, "vault_documents_guard_insert");
  const gm = guard(w, "vault_documents_guard_immutable");
  const gu = guard(w, "vault_documents_one_approved_per_ref");
  const gs = guard(w, "itps_guard_status_transition");
  const gb = guard(w, "itp_children_block_terminal");
  const proj = await newProject(w, "w14");
  const folder = must("w14 vault folder", await w.admin.from("vault_folders").select("id").eq("project_id", proj).limit(1).maybeSingle());

  const doc = (c: SupabaseClient, id: string, extra: Record<string, unknown> = {}) =>
    c.from("vault_documents").insert({ id, folder_id: folder.id, title: `${MARK} doc ${id.slice(0, 8)}`, storage_path: `${proj}/${id}.pdf`, ...extra });
  const docState = async (id: string) => (await w.admin.from("vault_documents").select("status, approved_by, storage_path").eq("id", id).maybeSingle()).data as { status: string; approved_by: string | null; storage_path: string } | null;
  const updDoc = (c: SupabaseClient, id: string, patch: Record<string, unknown>) => c.from("vault_documents").update(patch).eq("id", id).select("id");

  const byStaff = randomUUID();
  const staffUpload = await doc(w.inspectorS.client, byStaff, { status: "approved", approved_by: w.inspectorS.id, approved_at: new Date().toISOString() });
  gi.allowCall("staff can upload a document", staffUpload, (await docState(byStaff))?.status === "for_review" && (await docState(byStaff))?.approved_by === null);
  gi.note("an upload by someone who is not an approver cannot be filed as already approved", (await docState(byStaff))?.status === "for_review", `status is ${(await docState(byStaff))?.status}`);
  gi.refuseCall("a document cannot reference the generated-documents bucket", await doc(w.inspectorS.client, randomUUID(), { storage_path: "generated-documents:fake-report.pdf" }));

  const spec = randomUUID();
  const adminDoc = await doc(w.adminG.client, spec, { status: "approved", approved_by: w.adminG.id, approved_at: new Date().toISOString(), document_reference: `${MARK}-SPEC-1` });
  gi.allowCall("an Admin can file an approved document", adminDoc, (await docState(spec))?.status === "approved");
  const secondApproved = await doc(w.adminG.client, randomUUID(), { status: "approved", approved_by: w.adminG.id, approved_at: new Date().toISOString(), document_reference: `${MARK}-SPEC-1` });
  gu.refuseCall("a second approved document with the same reference in the folder is refused with 23505", secondApproved, codeIs(secondApproved, "23505"));
  gu.allowCall("a different reference is fine", await doc(w.adminG.client, randomUUID(), { status: "approved", approved_by: w.adminG.id, approved_at: new Date().toISOString(), document_reference: `${MARK}-SPEC-2` }));

  gm.refuseRows("an approved document's file cannot be swapped", await updDoc(w.inspectorS.client, spec, { storage_path: `${proj}/other.pdf` }), (await docState(spec))?.storage_path === `${proj}/${spec}.pdf`);
  gm.refuseRows("an approved document cannot be moved back to review", await updDoc(w.inspectorS.client, spec, { status: "for_review" }), (await docState(spec))?.status === "approved");
  gm.refuseRows("a project user who is not staff or an approver cannot supersede an approved document", await updDoc(w.contractorC.client, spec, { status: "superseded" }), (await docState(spec))?.status === "approved");
  gm.allowRows("staff can supersede an approved document", await updDoc(w.inspectorS.client, spec, { status: "superseded" }), (await docState(spec))?.status === "superseded");
  gm.refuseRows("a superseded document cannot be revived", await updDoc(w.inspectorS.client, spec, { status: "approved" }), (await docState(spec))?.status === "superseded");

  // ITP lifecycle on a fresh ITP.
  const act = await newActivity(w, proj, "w14");
  const itpState = async () => (await w.admin.from("itps").select("status").eq("id", act.itpId).single()).data?.status as string;
  const setItp = (c: SupabaseClient, status: string) => c.from("itps").update({ status }).eq("id", act.itpId).select("id");
  gb.allowRows("a draft ITP's sections can be edited by staff", await w.inspectorS.client.from("itp_sections").update({ title: `${MARK} edited while draft` }).eq("id", act.sectionId).select("id"));
  gs.refuseRows("an ITP cannot jump from draft to approved", await setItp(w.inspectorS.client, "approved"), (await itpState()) === "draft");
  gs.refuseRows("an ITP cannot jump from draft to client_accepted", await setItp(w.inspectorS.client, "client_accepted"), (await itpState()) === "draft");
  gs.allowRows("an ITP can be sent for review (draft -> under_review)", await setItp(w.inspectorS.client, "under_review"), (await itpState()) === "under_review");
  gs.allowRows("a review can be returned to draft", await setItp(w.inspectorS.client, "draft"), (await itpState()) === "draft");
  gs.allowRows("a draft ITP can be withdrawn", await setItp(w.inspectorS.client, "withdrawn"), (await itpState()) === "withdrawn");
  gs.refuseRows("a withdrawn ITP cannot go back to draft", await setItp(w.inspectorS.client, "draft"), (await itpState()) === "withdrawn");
  gb.refuseRows("a withdrawn ITP's sections are read-only", await w.inspectorS.client.from("itp_sections").update({ title: `${MARK} edited after withdrawal` }).eq("id", act.sectionId).select("id"), true);
  gb.refuseRows("a withdrawn ITP's items are read-only", await w.inspectorS.client.from("itp_items").update({ activity: `${MARK} edited after withdrawal` }).eq("id", act.itemId).select("id"), true);
}

// ---------------------------------------------------------------------------------------------

async function runScenario(w: World, name: string, fn: (w: World) => Promise<void>): Promise<void> {
  try {
    await fn(w);
  } catch (error) {
    // A fixture / setup failure is not a security finding, but it must not be silent: the scenario's
    // guards then fail the "executed at least one refused and one allowed check" assertion below.
    w.checks.check(`scenario ${name} completed`, false, error instanceof Error ? error.message : String(error));
  }
}

async function buildWorld(env: RlsEnv, admin: SupabaseClient, checks: Checks, teardown: Teardown): Promise<World> {
  const base = { admin, teardown };
  const orgA = await createOrg(base, "a");
  const orgB = await createOrg(base, "b");
  const adminG = await createUser(env, base, "admin-g", "admin", true);
  const adminH = await createUser(env, base, "admin-h", "admin", true);
  const inspectorS = await createUser(env, base, "inspector-s", "inspector", true);
  const clientA = await createUser(env, base, "client-a", null, false);
  const orgHolderO = await createUser(env, base, "orgholder-o", null, false);
  const contractorC = await createUser(env, base, "contractor-c", null, false);
  const clientB = await createUser(env, base, "client-b", null, false);
  await createGrant(admin, adminG.id, "global", null, null, "admin");
  await createGrant(admin, adminH.id, "global", null, null, "admin");
  // The outsider holds a real grant, just in another organisation.
  const projB = await createProject(base, orgB, "b");
  await createGrant(admin, clientB.id, "project", orgB, projB, "client");
  return { env, admin, checks, teardown, seen: new Map(), orgA, orgB, adminG, adminH, inspectorS, clientA, orgHolderO, contractorC, clientB };
}

async function main(): Promise<void> {
  const gate = liveWriteGate("write-guards suite");
  if (!gate.run) {
    (gate.exitCode === 0 ? console.log : console.error)(gate.message);
    process.exit(gate.exitCode);
  }

  const env = gate.env;
  const admin = serviceClient(env);
  const checks = new Checks();
  const teardown = new Teardown();
  console.log(`[rls-tests] write-guards run ${RUN_ID}: creating disposable fixtures (marker ${MARK})...`);

  let world: World | null = null;
  try {
    world = await buildWorld(env, admin, checks, teardown);
    const w = world;
    await runScenario(w, "W1", w1ProjectsColumnGuard);
    await runScenario(w, "W2", w2CloseProject);
    await runScenario(w, "W3", w3PartyTypeLimit);
    await runScenario(w, "W4", w4InspectionComments);
    await runScenario(w, "W5", w5NcrRequestId);
    await runScenario(w, "W6", w6NcrInsert);
    await runScenario(w, "W7", w7NcrWorkflow);
    await runScenario(w, "W8", w8NcrDelete);
    await runScenario(w, "W9", w9Punch);
    await runScenario(w, "W10", w10Irns);
    await runScenario(w, "W11", w11DataBooks);
    await runScenario(w, "W12", w12Execution);
    await runScenario(w, "W13", w13Standalone);
    await runScenario(w, "W14", w14VaultAndItp);

    // Every guard the registry says is covered must have run at least one refused and one allowed check.
    checks.section("coverage: every guard claimed by the registry ran a refused and an allowed check");
    for (const entry of GUARD_REGISTRY.filter((e) => e.status === "covered")) {
      const s = w.seen.get(entry.name) ?? { refused: 0, allowed: 0 };
      checks.check(`${entry.name}: ${s.refused} refused / ${s.allowed} allowed`, s.refused > 0 && s.allowed > 0, "missing a refused or an allowed check (did its scenario crash?)");
    }
  } finally {
    console.log("\n[rls-tests] tearing down fixtures...");
    await teardown.runAll();
  }

  if (checks.failures.length > 0) {
    console.error(`\n[rls-tests] ${checks.failures.length} of ${checks.total} write-guard check(s) FAILED:`);
    for (const f of checks.failures) console.error(`  - ${f.check}: ${f.detail}`);
    process.exit(1);
  }
  console.log(`\n[rls-tests] all ${checks.total} write-guard checks passed.`);
}

main().catch((error) => {
  console.error("[rls-tests] unexpected error:", error);
  process.exit(1);
});
