"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { createNotification } from "@/lib/notifications/helpers";
import {
  PUNCH_LIST_ITEMS_TABLE,
  PUNCH_LIST_PRIORITIES,
  PUNCH_LIST_SOURCES,
  PUNCH_PHOTO_MAX_BYTES,
  type PunchListPriority,
  type PunchListSource,
} from "@/lib/punch-list/types";

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function parsePriority(v: FormDataEntryValue | null | undefined): PunchListPriority {
  const t = String(v ?? "").trim().toUpperCase();
  return (PUNCH_LIST_PRIORITIES as readonly string[]).includes(t) ? (t as PunchListPriority) : "B";
}

function validDueDate(v: string): boolean {
  return !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()));
}

/** The responsible party must be a party of THIS project (not just any party id). */
async function partyBelongsToProject(supabase: Supa, projectId: string, partyId: string): Promise<boolean> {
  if (!partyId) return true;
  const { data } = await supabase
    .from("project_parties")
    .select("id")
    .eq("id", partyId)
    .eq("project_id", projectId)
    .maybeSingle<{ id: string }>();
  return !!data;
}

/** Images only, 25 MB each, stored under a project-scoped path in the evidence bucket. */
async function uploadPunchPhotos(
  supabase: Supa,
  projectId: string,
  files: FormDataEntryValue[]
): Promise<{ paths: string[]; error: string | null }> {
  const paths: string[] = [];
  for (const f of files) {
    if (typeof f === "string" || !f.size) continue;
    if (!f.type.startsWith("image/")) return { paths, error: `${f.name}: only image files can be attached.` };
    if (f.size > PUNCH_PHOTO_MAX_BYTES) return { paths, error: `${f.name} is larger than 25 MB.` };
    const ext = (f.name.split(".").pop() ?? "jpg").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `${projectId}/punch/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("inspection-evidence").upload(path, f, { contentType: f.type });
    if (error) return { paths, error: "A photo could not be uploaded. Nothing was saved; try again." };
    paths.push(path);
  }
  return { paths, error: null };
}

function punchLink(projectId: string, itemId: string): string {
  return `/inspect/projects/${projectId}/punch-list?item=${itemId}`;
}

async function notifyUsers(
  supabase: Supa,
  projectId: string,
  actorId: string | null,
  userIds: (string | null | undefined)[],
  itemId: string,
  title: string,
  body: string
) {
  try {
    const orgId = await findOrgForProject(supabase, projectId);
    if (!orgId) return;
    for (const uid of new Set(userIds.filter((u): u is string => !!u && u !== actorId))) {
      await createNotification(supabase, {
        organizationId: orgId,
        projectId,
        recipientUserId: uid,
        title,
        body,
        link: punchLink(projectId, itemId),
      });
    }
  } catch {
    // Best-effort.
  }
}

async function partyUserId(supabase: Supa, partyId: string | null): Promise<string | null> {
  if (!partyId) return null;
  const { data } = await supabase
    .from("project_parties")
    .select("user_id")
    .eq("id", partyId)
    .maybeSingle<{ user_id: string | null }>();
  return data?.user_id ?? null;
}

export interface AddPunchItemState {
  error: string | null;
}

async function findOrgForProject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();
  return data?.organization_id ?? null;
}

/** Manual "add punch item" form on the project's punch list register. */
export async function addPunchItemAction(
  _prev: AddPunchItemState,
  formData: FormData
): Promise<AddPunchItemState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const responsiblePartyId = String(formData.get("responsible_party_id") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();

  if (!projectId || !description) {
    return { error: "Description is required." };
  }
  if (!validDueDate(dueDate)) return { error: "Due date is not valid." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await partyBelongsToProject(supabase, projectId, responsiblePartyId))) {
    return { error: "The responsible party doesn't belong to this project." };
  }
  const photos = await uploadPunchPhotos(supabase, projectId, formData.getAll("photos"));
  if (photos.error) return { error: photos.error };
  const { data: item, error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .insert({
      project_id: projectId,
      description,
      source: "manual",
      location: location || null,
      responsible_party_id: responsiblePartyId || null,
      due_date: dueDate || null,
      priority: parsePriority(formData.get("priority")),
      photo_paths: photos.paths,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !item) {
    if (error?.code === "23503") {
      return { error: "The responsible party doesn't match a known project party." };
    }
    return { error: "Could not add the punch item. Check you have permission and try again." };
  }

  try {
    const organizationId = await findOrgForProject(supabase, projectId);
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "punch_list_item",
        entityId: item.id,
        action: "created",
        actorId: user?.id ?? null,
        summary: `Punch item added: ${description}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  await notifyUsers(
    supabase,
    projectId,
    user?.id ?? null,
    [await partyUserId(supabase, responsiblePartyId || null)],
    item.id,
    "Punch item assigned to you",
    description
  );

  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface ResolvePunchItemState {
  error: string | null;
}

/**
 * Step 1 of 2: marks a punch item resolved — the same "anyone with project access can do their own
 * work" boundary this table always had (open access, tenant isolation only at the RLS layer), since
 * fixing the underlying issue is routinely the contractor's/subcontractor's own work, not
 * JAGS-staff-only. Evidence of what was actually done is required and enforced here, in the action
 * — the real authority boundary, not left to the UI to withhold the button.
 *
 * This does NOT close the item. Closing is a separate, independently-gated step (closePunchItemAction
 * below) — the gap this two-step split exists to close: previously the SAME person could resolve
 * and close in one move with no independent check, same self-certification problem this app already
 * avoids for NCR close-out/vault approval/IRN issuance.
 */
export async function resolvePunchItemAction(
  _prev: ResolvePunchItemState,
  formData: FormData
): Promise<ResolvePunchItemState> {
  const punchItemId = String(formData.get("punch_item_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const closingEvidence = String(formData.get("closing_evidence") ?? "").trim();

  if (!punchItemId || !projectId) {
    return { error: "Missing punch item." };
  }
  if (!closingEvidence) {
    return { error: "Evidence of what was done is required before this item can be marked resolved." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error, data } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update({
      status: "resolved",
      closing_evidence: closingEvidence,
      resolved_by: user?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", punchItemId)
    .eq("status", "open")
    .eq("project_id", projectId)
    .select("id, created_by, description")
    .returns<{ id: string; created_by: string | null; description: string }[]>();

  if (error) {
    return { error: "Could not mark the punch item resolved. Check you have permission and try again." };
  }
  if (!data || data.length === 0) {
    return { error: "This item isn't open (already resolved or closed)." };
  }

  try {
    const organizationId = await findOrgForProject(supabase, projectId);
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "punch_list_item",
        entityId: punchItemId,
        action: "resolved",
        actorId: user?.id ?? null,
        summary: "Punch item marked resolved, awaiting verification",
        changes: { closing_evidence: closingEvidence },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  await notifyUsers(
    supabase,
    projectId,
    user?.id ?? null,
    [data[0].created_by],
    punchItemId,
    "Punch item awaiting your verification",
    `${data[0].description} - closing evidence: ${closingEvidence}`.slice(0, 300)
  );

  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface ClosePunchItemState {
  error: string | null;
}

/**
 * Step 2 of 2: verifies and closes a RESOLVED punch item — "high authority by default, delegatable
 * per person", same model as approveVaultDocumentAction (lib/vault/actions.ts): a JAGS Admin always
 * can; anyone else needs the close_punch_item custom-role permission (deliberately NOT grantable by
 * a self-managed/client-managed client to its own role — see CLIENT_SELF_SERVICE_PERMISSION_KEYS's
 * doc comment — closing out your own fix without independent review is the same self-certification
 * concern as an NCR close-out or a vault-document approval).
 *
 * Only fires from status = 'resolved' (the .eq("status","resolved") below) — you cannot close an
 * item straight from 'open', skipping the independent-fix-verification step entirely.
 */
export async function closePunchItemAction(
  _prev: ClosePunchItemState,
  formData: FormData
): Promise<ClosePunchItemState> {
  const punchItemId = String(formData.get("punch_item_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const verificationNotes = String(formData.get("verification_notes") ?? "").trim();

  if (!punchItemId || !projectId) {
    return { error: "Missing punch item." };
  }
  if (!verificationNotes) {
    return { error: "Verification notes are required before this item can be closed." };
  }

  const session = await requireSession();
  const allowed = isAdminStaff(session) || (await hasPermission(session.userId, "close_punch_item", projectId));
  if (!allowed) {
    return { error: "Only a JAGS Admin, or someone granted this permission, can verify and close a punch item." };
  }

  const supabase = await createSupabaseServerClient();

  // Real self-certification gap the two-step split exists to close: without this check, whoever
  // clicked "Mark resolved" could immediately click "Verify & close" on their own fix, defeating
  // the entire point of the independent-verification step (identical concern to NCR close-out and
  // vault-document approval, both of which are single-actor already). Not gated on isAdminStaff()
  // either — an Admin who did the fix themselves still isn't an INDEPENDENT reviewer of it.
  const { data: existing } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("resolved_by")
    .eq("id", punchItemId)
    .maybeSingle<{ resolved_by: string | null }>();
  if (existing?.resolved_by && existing.resolved_by === session.userId) {
    return { error: "You marked this item resolved — a different person must independently verify and close it." };
  }

  const { error, data } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update({
      status: "closed",
      verification_notes: verificationNotes,
      closed_by: session.userId,
      closed_at: new Date().toISOString(),
    })
    .eq("id", punchItemId)
    .eq("status", "resolved")
    .eq("project_id", projectId)
    .select("id, created_by, resolved_by, description")
    .returns<{ id: string; created_by: string | null; resolved_by: string | null; description: string }[]>();

  if (error) {
    return { error: "Could not close the punch item. Check you have permission and try again." };
  }
  if (!data || data.length === 0) {
    return { error: "This item isn't awaiting verification yet — it must be marked resolved first." };
  }

  try {
    const organizationId = await findOrgForProject(supabase, projectId);
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "punch_list_item",
        entityId: punchItemId,
        action: "closed",
        actorId: session.userId,
        summary: "Punch item verified and closed",
        changes: { verification_notes: verificationNotes },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  await notifyUsers(
    supabase,
    projectId,
    session.userId,
    [data[0].resolved_by, data[0].created_by],
    punchItemId,
    "Punch item verified and closed",
    data[0].description
  );

  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface ReopenPunchItemState {
  error: string | null;
}

/**
 * Sends a resolved item back to open (verifier rejects the fix) or reopens a closed one. Requires a
 * reason and the close_punch_item permission (same authority as verifying); atomic on status.
 */
export async function reopenPunchItemAction(
  _prev: ReopenPunchItemState,
  formData: FormData
): Promise<ReopenPunchItemState> {
  const punchItemId = String(formData.get("punch_item_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!punchItemId || !projectId) return { error: "Missing punch item." };
  if (!reason) return { error: "A reason is required to reopen a punch item." };

  const session = await requireSession();
  const allowed = isAdminStaff(session) || (await hasPermission(session.userId, "close_punch_item", projectId));
  if (!allowed) return { error: "Only a JAGS Admin, or someone granted this permission, can reopen a punch item." };

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("status, reopen_count")
    .eq("id", punchItemId)
    .eq("project_id", projectId)
    .maybeSingle<{ status: string; reopen_count: number | null }>();
  if (!current || current.status === "open") return { error: "This item is already open." };

  const { error, data } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update({
      status: "open",
      reopen_reason: reason,
      reopened_by: session.userId,
      reopened_at: new Date().toISOString(),
      reopen_count: (current.reopen_count ?? 0) + 1,
      resolved_by: null,
      resolved_at: null,
      closed_by: null,
      closed_at: null,
    })
    .eq("id", punchItemId)
    .eq("project_id", projectId)
    .eq("status", current.status)
    .select("id, created_by, resolved_by, responsible_party_id, description")
    .returns<{ id: string; created_by: string | null; resolved_by: string | null; responsible_party_id: string | null; description: string }[]>();
  if (error) return { error: "Could not reopen the punch item." };
  if (!data || data.length === 0) return { error: "This item changed meanwhile - refresh and try again." };

  try {
    const organizationId = await findOrgForProject(supabase, projectId);
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "punch_list_item",
        entityId: punchItemId,
        action: "reopened",
        actorId: session.userId,
        summary: `Punch item reopened: ${reason}`,
        changes: { reason, from: current.status },
      });
    }
  } catch {
    // Best-effort.
  }
  await notifyUsers(
    supabase,
    projectId,
    session.userId,
    [data[0].resolved_by, data[0].created_by, await partyUserId(supabase, data[0].responsible_party_id)],
    punchItemId,
    "Punch item reopened",
    `${data[0].description} - ${reason}`.slice(0, 300)
  );
  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface RecordWalkdownState {
  error: string | null;
  addedCount?: number;
}

/**
 * R95: records a final walk-down and logs one or more punch-list items directly from it, source
 * correctly tagged 'walkdown' — the flow the audit found missing (the enum value existed with an
 * explicit "no such flow yet" comment; see the doc comment above createPunchItemFromSource).
 *
 * Scoping matches the existing sources' pattern: each of the other three sources ties its punch
 * item back to the specific record it came from via a dedicated source_*_id FK (inspection_failure ->
 * source_inspection_record_id, fat_conditional_pass -> source_standalone_assignment_id, ncr ->
 * source_ncr_id). A walk-down has no equivalent record of its own in this schema — it isn't backed by
 * an inspection_record, a standalone_assignment or an NCR, and inventing a whole new "walk-down
 * inspection record" entity just to hang an FK off it would be exactly the over-building this task
 * warned against. So a walkdown item is scoped the same way a 'manual' item is: to the project
 * (source_inspection_record_id / source_standalone_assignment_id / source_ncr_id all stay null),
 * differing from 'manual' only in the source tag itself — which is the real, honest signal: "raised
 * while walking the project down", not "added ad hoc". A free-text `location` field (already on the
 * table) is how the inspector notes which ITP/area/section an item came from, same as every other
 * source here does — none of the three wired sources link to a specific ITP or section either.
 *
 * One submit can log several items at once (a walk-down routinely turns up more than one thing) —
 * the form repeats `description`/`location`/`responsible_party_id`/`due_date` per row and this
 * action zips them back together by position via FormData.getAll, then inserts every row with a
 * non-empty description in one batch insert.
 */
export async function recordWalkdownAction(
  _prev: RecordWalkdownState,
  formData: FormData
): Promise<RecordWalkdownState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectId) {
    return { error: "Missing project." };
  }

  const descriptions = formData.getAll("description").map((v) => String(v).trim());
  const locations = formData.getAll("location").map((v) => String(v).trim());
  const responsibleParties = formData.getAll("responsible_party_id").map((v) => String(v).trim());
  const dueDates = formData.getAll("due_date").map((v) => String(v).trim());
  const priorities = formData.getAll("priority");
  const rowKeys = formData.getAll("row_key").map((v) => String(v));
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    if (!descriptions[i]) continue;
    if (!validDueDate(dueDates[i] ?? "")) return { error: `Item ${i + 1}: due date is not valid.` };
    if (!(await partyBelongsToProject(supabase, projectId, responsibleParties[i] ?? ""))) {
      return { error: `Item ${i + 1}: responsible party doesn't belong to this project.` };
    }
    const photos = await uploadPunchPhotos(supabase, projectId, formData.getAll(`photos_${rowKeys[i] ?? ""}`));
    if (photos.error) return { error: `Item ${i + 1}: ${photos.error}` };
    rows.push({
      project_id: projectId,
      description: descriptions[i],
      source: "walkdown",
      location: locations[i] || null,
      responsible_party_id: responsibleParties[i] || null,
      due_date: dueDates[i] || null,
      priority: parsePriority(priorities[i]),
      photo_paths: photos.paths,
      created_by: user?.id ?? null,
    });
  }

  if (rows.length === 0) {
    return { error: "Add at least one item found during the walk-down before recording it." };
  }

  const { data: inserted, error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .insert(rows)
    .select("id, responsible_party_id, description")
    .returns<{ id: string; responsible_party_id: string | null; description: string }[]>();

  if (error) {
    if (error.code === "23503") {
      return { error: "A responsible party doesn't match a known project party." };
    }
    return { error: "Could not record the walk-down. Check you have permission and try again." };
  }

  try {
    const organizationId = await findOrgForProject(supabase, projectId);
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "punch_list_item",
        entityId: projectId,
        action: "walkdown_recorded",
        actorId: user?.id ?? null,
        summary: `Walk-down recorded — ${rows.length} punch item(s) added`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  for (const it of inserted ?? []) {
    await notifyUsers(
      supabase,
      projectId,
      user?.id ?? null,
      [await partyUserId(supabase, it.responsible_party_id)],
      it.id,
      "Punch item assigned to you",
      it.description
    );
  }

  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null, addedCount: rows.length };
}

/**
 * Reusable helper for other features to auto-create a project-wide punch item off one of the
 * defined sources, instead of hand-rolling the insert. Wired into:
 *
 *  - checklist completion (apps/web/lib/checklists/actions.ts, when an inspection_record is
 *    completed with a 'no' response on a mandatory checklist_items row): source: 'inspection_failure',
 *    sourceInspectionRecordId.
 *  - standalone assignment finalize (apps/web/lib/standalone/actions.ts, when
 *    conclusion = 'conditional_pass'): source: 'fat_conditional_pass', sourceStandaloneAssignmentId.
 *  - NCR raise (apps/web/lib/ncrs/actions.ts createNcrAction): source: 'ncr', sourceNcrId.
 *  - ITP measurement-record evidence turning newly Fail (apps/web/lib/itps/evidence-actions.ts,
 *    add/updateItpItemMeasurementAction): source: 'itp_measurement_failure', sourceItpItemId. One
 *    item per newly-failing row, not one per activity — unlike a checklist, evidence_type=3 has no
 *    single "complete" action to hang an aggregate check off.
 *
 * Manual, undifferentiated entries go through addPunchItemAction above (source: 'manual').
 * 'walkdown'-sourced items are produced by recordWalkdownAction below (R95): a final walk-down is a
 * distinct event from an ad hoc manual entry — one inspector/client sweep of the project that can
 * surface several items at once, tagged so the register can tell "raised during the walk-down" apart
 * from "someone added this later". recordWalkdownAction inserts directly (it needs to insert several
 * rows from one submit) rather than looping this helper, but tags every row source: 'walkdown' the
 * same way this helper would.
 */
export async function createPunchItemFromSource(params: {
  projectId: string;
  description: string;
  source: PunchListSource;
  sourceInspectionRecordId?: string;
  sourceStandaloneAssignmentId?: string;
  sourceNcrId?: string;
  sourceItpItemId?: string;
  location?: string;
  responsiblePartyId?: string;
  dueDate?: string;
}): Promise<{ error: string | null }> {
  if (!PUNCH_LIST_SOURCES.includes(params.source)) {
    return { error: "Invalid punch list source." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: item, error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .insert({
      project_id: params.projectId,
      description: params.description,
      source: params.source,
      source_inspection_record_id: params.sourceInspectionRecordId ?? null,
      source_standalone_assignment_id: params.sourceStandaloneAssignmentId ?? null,
      source_ncr_id: params.sourceNcrId ?? null,
      source_itp_item_id: params.sourceItpItemId ?? null,
      location: params.location ?? null,
      responsible_party_id: params.responsiblePartyId ?? null,
      due_date: params.dueDate ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !item) {
    return { error: "Could not create the punch item." };
  }

  try {
    const organizationId = await findOrgForProject(supabase, params.projectId);
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: params.projectId,
        entityType: "punch_list_item",
        entityId: item.id,
        action: "created",
        actorId: user?.id ?? null,
        summary: `Punch item auto-created (${params.source}): ${params.description}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${params.projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${params.projectId}/data-book`);
  return { error: null };
}
