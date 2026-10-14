"use server";

import type { FieldErrors } from "@/lib/forms/field-errors";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { createNotification } from "@/lib/notifications/helpers";
import { directoryClient, partyUserIds as directoryPartyUserIds } from "@/lib/ncrs/recipients";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { resolveSiteTimeZone, siteToday } from "@/lib/ncrs/site-date";
import { fetchProjectTimeZone } from "@/lib/projects/timezone";
import { walkdownSignOffError } from "@/lib/punch-list/walkdown";
import {
  PUNCH_LIST_ITEMS_TABLE,
  PUNCH_LIST_PRIORITIES,
  PUNCH_LIST_SOURCES,
  PUNCH_PHOTO_MAX_BYTES,
  type PunchListPriority,
  type PunchListSource,
} from "@/lib/punch-list/types";
import {
  PUNCH_MAX_DESCRIPTION,
  PUNCH_MAX_FILES_PER_ROW,
  PUNCH_MAX_LOCATION,
  PUNCH_MAX_WALKDOWN_ROWS,
  defaultPunchDueDate,
  resolvePunchDueDate,
  detectPunchImage,
  validDueDate,
} from "@/lib/punch-list/helpers";

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function parsePriority(v: FormDataEntryValue | null | undefined): PunchListPriority {
  const t = String(v ?? "").trim().toUpperCase();
  return (PUNCH_LIST_PRIORITIES as readonly string[]).includes(t) ? (t as PunchListPriority) : "B";
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

/** Validates a set of party ids against the project in ONE query. Returns the ids that are not valid. */
async function invalidPartyIds(supabase: Supa, projectId: string, partyIds: string[]): Promise<string[]> {
  const unique = [...new Set(partyIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const { data } = await supabase
    .from("project_parties")
    .select("id")
    .eq("project_id", projectId)
    .in("id", unique)
    .returns<{ id: string }[]>();
  const ok = new Set((data ?? []).map((d) => d.id));
  return unique.filter((id) => !ok.has(id));
}

interface PreparedPhoto {
  file: File;
  ext: string;
  contentType: string;
}

/**
 * Validates every file (size, allowed raster type confirmed from the file BYTES + extension; SVG is
 * rejected) BEFORE anything is uploaded, so a bad third file doesn't leave two orphans in storage.
 */
async function preparePunchPhotos(files: FormDataEntryValue[]): Promise<{ prepared: PreparedPhoto[]; error: string | null }> {
  const real = files.filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (real.length > PUNCH_MAX_FILES_PER_ROW) {
    return { prepared: [], error: `At most ${PUNCH_MAX_FILES_PER_ROW} photos can be attached at a time.` };
  }
  const prepared: PreparedPhoto[] = [];
  for (const f of real) {
    if (f.size > PUNCH_PHOTO_MAX_BYTES) return { prepared: [], error: `${f.name} is larger than 25 MB.` };
    const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
    const kind = detectPunchImage(head, f.name);
    if (!kind) {
      return { prepared: [], error: `${f.name}: only JPEG, PNG, WebP or HEIC photos can be attached.` };
    }
    prepared.push({ file: f, ext: kind.ext, contentType: kind.contentType });
  }
  return { prepared, error: null };
}

async function removePunchPhotos(supabase: Supa, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from("inspection-evidence").remove(paths);
  } catch {
    // Best-effort cleanup.
  }
}

/** Uploads already-validated photos; on any failure removes whatever was uploaded so far. */
async function uploadPreparedPhotos(
  supabase: Supa,
  projectId: string,
  prepared: PreparedPhoto[]
): Promise<{ paths: string[]; error: string | null }> {
  const paths: string[] = [];
  for (const p of prepared) {
    const path = `${projectId}/punch/${crypto.randomUUID()}.${p.ext}`;
    const { error } = await supabase.storage.from("inspection-evidence").upload(path, p.file, { contentType: p.contentType });
    if (error) {
      await removePunchPhotos(supabase, paths);
      return { paths: [], error: "A photo could not be uploaded. Nothing was saved; try again." };
    }
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

/** The party's login (first of its users). Kept for single-recipient callers; see partyUsers for everyone. */
async function partyUserId(supabase: Supa, partyId: string | null): Promise<string | null> {
  return (await partyUsers(supabase, partyId))[0] ?? null;
}

/** The party's login plus its team members (they all act for the party). */
async function partyUsers(supabase: Supa, partyId: string | null): Promise<string[]> {
  if (!partyId) return [];
  return directoryPartyUserIds(supabase, partyId);
}

/**
 * Users who can verify/close on this project: holders of close_punch_item (project or org/platform
 * scoped assignment) plus org-level JAGS admin staff. Best-effort and RLS-bound: a caller who cannot
 * read the role tables simply gets fewer recipients (callers also add created_by as a fallback).
 */
async function verifierUserIds(callerClient: Supa, projectId: string, organizationId: string | null): Promise<string[]> {
  // Read through the directory client: RLS would show a contractor resolving an item only themselves.
  const supabase = directoryClient(callerClient) as unknown as Supa;
  const ids = new Set<string>();
  try {
    const { data: perms } = await supabase
      .from("custom_role_permissions")
      .select("role_id")
      .eq("permission_key", "close_punch_item")
      .returns<{ role_id: string }[]>();
    const roleIds = [...new Set((perms ?? []).map((p) => p.role_id))];
    if (roleIds.length > 0) {
      const { data: assigns } = await supabase
        .from("custom_role_assignments")
        .select("user_id, project_id")
        .in("role_id", roleIds)
        .returns<{ user_id: string; project_id: string | null }[]>();
      for (const a of assigns ?? []) if (a.project_id === null || a.project_id === projectId) ids.add(a.user_id);
    }
  } catch {
    // Best-effort.
  }
  try {
    if (organizationId) {
      const { data: grants } = await supabase
        .from("access_grants")
        .select("user_id")
        .or(`scope_type.eq.global,and(scope_type.eq.organization,organization_id.eq.${organizationId})`)
        .returns<{ user_id: string }[]>();
      const candidates = [...new Set((grants ?? []).map((g) => g.user_id))];
      if (candidates.length > 0) {
        const { data: admins } = await supabase
          .from("users")
          .select("id")
          .in("id", candidates)
          .eq("is_jags_staff", true)
          .eq("is_active", true)
          .neq("staff_role", "inspector")
          .returns<{ id: string }[]>();
        for (const a of admins ?? []) ids.add(a.id);
      }
    }
  } catch {
    // Best-effort.
  }
  return [...ids];
}

export interface AddPunchItemState {
  error: string | null;
  /** Per-input problems (keys are form field names), shown next to the field; `error` stays the fallback. */
  fieldErrors?: FieldErrors;
  /** True after a successful add: the form resets and shows a confirmation. */
  added?: boolean;
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
  const requestId = String(formData.get("request_id") ?? "").trim().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);

  if (!projectId || !description) {
    return { error: "Description is required.", fieldErrors: { description: "Description is required." } };
  }
  if (description.length > PUNCH_MAX_DESCRIPTION) {
    const msg = `Description is too long (max ${PUNCH_MAX_DESCRIPTION} characters).`;
    return { error: msg, fieldErrors: { description: msg } };
  }
  if (location.length > PUNCH_MAX_LOCATION) {
    const msg = `Location is too long (max ${PUNCH_MAX_LOCATION} characters).`;
    return { error: msg, fieldErrors: { location: msg } };
  }
  if (!validDueDate(dueDate)) return { error: "Due date is not valid.", fieldErrors: { due_date: "Due date is not valid." } };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await partyBelongsToProject(supabase, projectId, responsiblePartyId))) {
    return { error: "The responsible party doesn't belong to this project.", fieldErrors: { responsible_party_id: "The responsible party doesn't belong to this project." } };
  }
  // A retried submit (double tap, refresh) with the same request id is a no-op, not a second item.
  if (requestId) {
    const { data: already, error: alreadyErr } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id")
      .eq("project_id", projectId)
      .eq("client_request_id", requestId)
      .maybeSingle<{ id: string }>();
    if (!alreadyErr && already) return { error: null, added: true };
  }
  const prep = await preparePunchPhotos(formData.getAll("photos"));
  if (prep.error) return { error: prep.error };
  const photos = await uploadPreparedPhotos(supabase, projectId, prep.prepared);
  if (photos.error) return { error: photos.error };
  const priority = parsePriority(formData.get("priority"));
  // No typed due date: default it from the priority, counted from the project's site day.
  const siteDay = siteToday(new Date(), resolveSiteTimeZone(await fetchProjectTimeZone(supabase, projectId)));
  const itemPayload: Record<string, unknown> = {
    project_id: projectId,
    description,
    source: "manual",
    location: location || null,
    responsible_party_id: responsiblePartyId || null,
    due_date: resolvePunchDueDate(dueDate, priority, siteDay),
    priority,
    photo_paths: photos.paths,
    created_by: user?.id ?? null,
  };
  let { data: item, error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .insert(requestId ? { ...itemPayload, client_request_id: requestId } : itemPayload)
    .select("id")
    .single<{ id: string }>();
  if (error && requestId && error.code === "23505") {
    // Lost the race to an identical request: the item exists.
    await removePunchPhotos(supabase, photos.paths);
    return { error: null, added: true };
  }
  if (error && requestId && isMissingSchemaError(error)) {
    ({ data: item, error } = await supabase.from(PUNCH_LIST_ITEMS_TABLE).insert(itemPayload).select("id").single<{ id: string }>());
  }

  if (error || !item) {
    await removePunchPhotos(supabase, photos.paths);
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
  return { error: null, added: true };
}

export interface ResolvePunchItemState {
  error: string | null;
}

/**
 * Step 1 of 2: marks a punch item resolved — the same "anyone with project access can do their own
 * work" boundary this table always had (open access, tenant isolation only at the RLS layer), since
 * fixing the underlying issue is routinely the contractor's/subcontractor's own work, not
 * JAGS-staff-only. Evidence of what was actually done is required and enforced here, in the action
 * — the real authority boundary, not left to the UI to withhold the button. resolved_by is always
 * the authenticated user, set server-side. The resolver may attach photos of the fix.
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
  if (closingEvidence.length > PUNCH_MAX_DESCRIPTION) {
    return { error: `Evidence is too long (max ${PUNCH_MAX_DESCRIPTION} characters).` };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in." };

  const prep = await preparePunchPhotos(formData.getAll("closing_photos"));
  if (prep.error) return { error: prep.error };
  // Same rule as NCR close-out: a fix needs photographic proof, not only a sentence.
  if (prep.prepared.length === 0) return { error: "Attach at least one photo of the fix before marking this item resolved." };
  const photos = await uploadPreparedPhotos(supabase, projectId, prep.prepared);
  if (photos.error) return { error: photos.error };

  const update: Record<string, unknown> = {
    status: "resolved",
    closing_evidence: closingEvidence,
    resolved_by: user.id,
    resolved_at: new Date().toISOString(),
  };
  if (photos.paths.length > 0) update.closing_photo_paths = photos.paths;

  const { error, data } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update(update)
    .eq("id", punchItemId)
    .eq("status", "open")
    .eq("project_id", projectId)
    .select("id, created_by, description")
    .returns<{ id: string; created_by: string | null; description: string }[]>();

  if (error) {
    await removePunchPhotos(supabase, photos.paths);
    return { error: "Could not mark the punch item resolved. Check you have permission and try again." };
  }
  if (!data || data.length === 0) {
    await removePunchPhotos(supabase, photos.paths);
    return { error: "This item isn't open (already resolved or closed)." };
  }

  let organizationId: string | null = null;
  try {
    organizationId = await findOrgForProject(supabase, projectId);
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "punch_list_item",
        entityId: punchItemId,
        action: "resolved",
        actorId: user.id,
        summary: "Punch item marked resolved, awaiting verification",
        changes: { closing_evidence: closingEvidence, closing_photos: photos.paths.length },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  await notifyUsers(
    supabase,
    projectId,
    user.id,
    [...(await verifierUserIds(supabase, projectId, organizationId)), data[0].created_by],
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
  // Admin override (audit M8): lets a JAGS Admin close an item they resolved themselves, with a reason.
  const overrideReason = String(formData.get("override_reason") ?? "").trim();
  const isOverride = overrideReason.length > 0;

  if (!punchItemId || !projectId) {
    return { error: "Missing punch item." };
  }
  if (!verificationNotes) {
    return { error: "Verification notes are required before this item can be closed." };
  }
  if (isOverride && overrideReason.length < 10) {
    return { error: "An override reason of at least 10 characters is required." };
  }
  if (verificationNotes.length > PUNCH_MAX_DESCRIPTION) {
    return { error: `Notes are too long (max ${PUNCH_MAX_DESCRIPTION} characters).` };
  }

  const session = await requireSession();
  const allowed = isAdminStaff(session) || (await hasPermission(session.userId, "close_punch_item", projectId));
  if (!allowed) {
    return { error: "Only a JAGS Admin, or someone granted this permission, can verify and close a punch item." };
  }

  if (isOverride && !isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can close a punch item with an override reason." };
  }

  const supabase = await createSupabaseServerClient();

  // The different-person rule is enforced INSIDE the UPDATE (no read-then-write gap): the row only
  // matches when resolved_by is NOT NULL and differs from the closer. An Admin who did the fix
  // themselves still isn't an independent reviewer of it, unless they use the audited override.
  let closeQuery = supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update({
      status: "closed",
      verification_notes: verificationNotes,
      closed_by: session.userId,
      closed_at: new Date().toISOString(),
      ...(isOverride ? { closed_override_reason: overrideReason } : {}),
    })
    .eq("id", punchItemId)
    .eq("status", "resolved")
    .eq("project_id", projectId);
  if (!isOverride) closeQuery = closeQuery.not("resolved_by", "is", null).neq("resolved_by", session.userId);
  const { error, data } = await closeQuery
    .select("id, created_by, resolved_by, description")
    .returns<{ id: string; created_by: string | null; resolved_by: string | null; description: string }[]>();

  if (error) {
    return { error: "Could not close the punch item. Check you have permission and try again." };
  }
  if (!data || data.length === 0) {
    // Work out why, only to give an accurate message (the guard itself already held).
    const { data: cur } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("status, resolved_by")
      .eq("id", punchItemId)
      .eq("project_id", projectId)
      .maybeSingle<{ status: string; resolved_by: string | null }>();
    if (cur?.status === "resolved" && cur.resolved_by === session.userId) {
      return { error: "You marked this item resolved — a different person must independently verify and close it." };
    }
    if (cur?.status === "resolved" && !cur.resolved_by) {
      return { error: "This item has no recorded resolver, so it cannot be independently verified. Send it back to open and have it resolved again." };
    }
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
        summary: isOverride ? "Punch item closed by admin override" : "Punch item verified and closed",
        changes: isOverride
          ? { verification_notes: verificationNotes, closed_override_reason: overrideReason }
          : { verification_notes: verificationNotes },
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
 * An NCR-sourced item also notifies the source NCR's raiser and assignee.
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
  if (reason.length > PUNCH_MAX_DESCRIPTION) return { error: `Reason is too long (max ${PUNCH_MAX_DESCRIPTION} characters).` };

  const session = await requireSession();
  const allowed = isAdminStaff(session) || (await hasPermission(session.userId, "close_punch_item", projectId));
  if (!allowed) return { error: "Only a JAGS Admin, or someone granted this permission, can reopen a punch item." };

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("status, reopen_count, source_ncr_id")
    .eq("id", punchItemId)
    .eq("project_id", projectId)
    .maybeSingle<{ status: string; reopen_count: number | null; source_ncr_id: string | null }>();
  if (!current) return { error: "This punch item could not be found." };
  if (current.status === "open") return { error: "This item is already open." };
  // S5-05: an NCR-sourced item follows its NCR. While the NCR is closed, re-open the NCR first (the
  // NCR re-open cascade then re-opens the item). Mirrored by punch_reopen_ncr_closed_guard in the DB.
  if (current.source_ncr_id) {
    const { data: srcNcr } = await supabase.from("ncrs").select("status").eq("id", current.source_ncr_id).maybeSingle<{ status: string }>();
    if (srcNcr?.status === "closed") {
      return { error: "This punch item came from an NCR that is closed. Re-open the NCR first; its punch item re-opens with it." };
    }
  }

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
      // The previous fix photos belong to the rejected attempt: clear them so they never sit next to the new resolution.
      closing_photo_paths: [],
    })
    .eq("id", punchItemId)
    .eq("project_id", projectId)
    .eq("status", current.status)
    .select("id, created_by, resolved_by, responsible_party_id, description, source_ncr_id")
    .returns<{ id: string; created_by: string | null; resolved_by: string | null; responsible_party_id: string | null; description: string; source_ncr_id: string | null }[]>();
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

  let ncrOwners: (string | null)[] = [];
  if (data[0].source_ncr_id) {
    try {
      const { data: ncr } = await supabase
        .from("ncrs")
        .select("raised_by, assigned_to")
        .eq("id", data[0].source_ncr_id)
        .maybeSingle<{ raised_by: string | null; assigned_to: string | null }>();
      ncrOwners = [ncr?.raised_by ?? null, ncr?.assigned_to ?? null];
    } catch {
      // Best-effort.
    }
  }
  await notifyUsers(
    supabase,
    projectId,
    session.userId,
    [data[0].resolved_by, data[0].created_by, ...(await partyUsers(supabase, data[0].responsible_party_id)), ...ncrOwners],
    punchItemId,
    "Punch item reopened",
    `${data[0].description} - ${reason}`.slice(0, 300)
  );
  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface UpdatePunchItemState {
  error: string | null;
}

/**
 * Edits an item's responsible party, due date, priority and location. Same authority as verifying
 * (JAGS Admin or close_punch_item holder). A closed item is final (reopen it first).
 */
export async function updatePunchItemAction(
  _prev: UpdatePunchItemState,
  formData: FormData
): Promise<UpdatePunchItemState> {
  const punchItemId = String(formData.get("punch_item_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const responsiblePartyId = String(formData.get("responsible_party_id") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "").trim().toUpperCase();
  if (!punchItemId || !projectId) return { error: "Missing punch item." };
  if (!validDueDate(dueDate)) return { error: "Due date is not valid." };
  if (location.length > PUNCH_MAX_LOCATION) return { error: `Location is too long (max ${PUNCH_MAX_LOCATION} characters).` };
  if (!(PUNCH_LIST_PRIORITIES as readonly string[]).includes(priorityRaw)) return { error: "Priority is not valid." };

  const session = await requireSession();
  const allowed = isAdminStaff(session) || (await hasPermission(session.userId, "close_punch_item", projectId));
  if (!allowed) return { error: "Only a JAGS Admin, or someone granted the verify permission, can edit a punch item." };

  const supabase = await createSupabaseServerClient();
  if (!(await partyBelongsToProject(supabase, projectId, responsiblePartyId))) {
    return { error: "The responsible party doesn't belong to this project." };
  }

  const { data: before } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("status, responsible_party_id, due_date, priority, location, description")
    .eq("id", punchItemId)
    .eq("project_id", projectId)
    .maybeSingle<{
      status: string;
      responsible_party_id: string | null;
      due_date: string | null;
      priority: string;
      location: string | null;
      description: string;
    }>();
  if (!before) return { error: "This punch item could not be found." };
  if (before.status === "closed") return { error: "A closed item can't be edited - reopen it first." };

  const next = {
    responsible_party_id: responsiblePartyId || null,
    due_date: dueDate || null,
    priority: priorityRaw,
    location: location || null,
  };
  const { data, error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update(next)
    .eq("id", punchItemId)
    .eq("project_id", projectId)
    .neq("status", "closed")
    .select("id")
    .returns<{ id: string }[]>();
  if (error) {
    if (error.code === "23503") return { error: "The responsible party doesn't match a known project party." };
    return { error: "Could not update the punch item. Check you have permission and try again." };
  }
  if (!data || data.length === 0) return { error: "This item changed meanwhile - refresh and try again." };

  const changes: Record<string, unknown> = {};
  if (before.responsible_party_id !== next.responsible_party_id) changes.responsible_party_id = { from: before.responsible_party_id, to: next.responsible_party_id };
  if (before.due_date !== next.due_date) changes.due_date = { from: before.due_date, to: next.due_date };
  if (before.priority !== next.priority) changes.priority = { from: before.priority, to: next.priority };
  if ((before.location ?? null) !== next.location) changes.location = { from: before.location, to: next.location };

  if (Object.keys(changes).length > 0) {
    try {
      const organizationId = await findOrgForProject(supabase, projectId);
      if (organizationId) {
        await recordAuditEvent(supabase, {
          organizationId,
          projectId,
          entityType: "punch_list_item",
          entityId: punchItemId,
          action: "updated",
          actorId: session.userId,
          summary: `Punch item edited (${Object.keys(changes).join(", ")})`,
          changes,
        });
      }
    } catch {
      // Best-effort.
    }
    if (changes.responsible_party_id && next.responsible_party_id) {
      await notifyUsers(
        supabase,
        projectId,
        session.userId,
        [await partyUserId(supabase, next.responsible_party_id)],
        punchItemId,
        "Punch item assigned to you",
        before.description
      );
    }
  }

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
 * A walkdown item is scoped like a 'manual' item: to the project (no source_* FK), differing only in
 * the source tag. A free-text `location` field notes the area/section.
 *
 * One submit can log several items at once (capped at PUNCH_MAX_WALKDOWN_ROWS) — the form repeats
 * `description`/`location`/`responsible_party_id`/`due_date` per row and this action zips them back
 * together by position via FormData.getAll. All rows (fields, party ids, photos) are validated
 * BEFORE any upload; uploaded photos are removed again if a later step fails.
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
  const requestId = String(formData.get("request_id") ?? "").trim().replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  // Walkdown header (S5-23): when, where, who attended.
  const walkedOnRaw = String(formData.get("walked_on") ?? "").trim();
  const walkdownArea = String(formData.get("walkdown_area") ?? "").trim().slice(0, 200);
  const walkdownAttendees = String(formData.get("walkdown_attendees") ?? "").trim().slice(0, 500);
  const walkdownNotes = String(formData.get("walkdown_notes") ?? "").trim().slice(0, 2000);
  if (!validDueDate(walkedOnRaw)) return { error: "Walkdown date is not valid." };

  if (descriptions.filter(Boolean).length > PUNCH_MAX_WALKDOWN_ROWS) {
    return { error: `A walk-down can record at most ${PUNCH_MAX_WALKDOWN_ROWS} items at a time.` };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Pass 1: validate every row (cheap, no I/O except one party lookup + reading file heads).
  const indexes: number[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    if (!descriptions[i]) continue;
    if (descriptions[i].length > PUNCH_MAX_DESCRIPTION) return { error: `Item ${i + 1}: description is too long (max ${PUNCH_MAX_DESCRIPTION} characters).` };
    if ((locations[i] ?? "").length > PUNCH_MAX_LOCATION) return { error: `Item ${i + 1}: location is too long (max ${PUNCH_MAX_LOCATION} characters).` };
    if (!validDueDate(dueDates[i] ?? "")) return { error: `Item ${i + 1}: due date is not valid.` };
    indexes.push(i);
  }
  const badParties = new Set(await invalidPartyIds(supabase, projectId, indexes.map((i) => responsibleParties[i] ?? "")));
  for (const i of indexes) {
    if (badParties.has(responsibleParties[i] ?? "")) {
      return { error: `Item ${i + 1}: responsible party doesn't belong to this project.` };
    }
  }
  const prepared = new Map<number, PreparedPhoto[]>();
  for (const i of indexes) {
    const prep = await preparePunchPhotos(formData.getAll(`photos_${rowKeys[i] ?? ""}`));
    if (prep.error) return { error: `Item ${i + 1}: ${prep.error}` };
    prepared.set(i, prep.prepared);
  }
  if (indexes.length === 0) {
    return { error: "Add at least one item found during the walk-down before recording it." };
  }

  // A retried submit (double tap / refresh) with the same request id has already been recorded.
  if (requestId) {
    const { count: already, error: alreadyErr } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .like("client_request_id", `${requestId}-%`);
    if (!alreadyErr && (already ?? 0) > 0) return { error: null, addedCount: already ?? 0 };
  }

  const siteDay = siteToday(new Date(), resolveSiteTimeZone(await fetchProjectTimeZone(supabase, projectId)));

  // Header record (best-effort: without the walkdowns table the items are still recorded, ungrouped).
  let walkdownId: string | null = null;
  {
    const { data: wd, error: wdErr } = await supabase
      .from("walkdowns" as never)
      .insert({
        project_id: projectId,
        walked_on: walkedOnRaw || siteDay,
        area: walkdownArea || null,
        attendees: walkdownAttendees || null,
        notes: walkdownNotes || null,
        item_count: indexes.length,
        created_by: user?.id ?? null,
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (!wdErr && wd) walkdownId = wd.id;
    else if (wdErr && !isMissingSchemaError(wdErr)) console.error("[punch] walkdown header failed", wdErr.message);
  }

  // Pass 2: upload, then insert; clean up uploads if anything fails.
  const uploaded: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const i of indexes) {
    const photos = await uploadPreparedPhotos(supabase, projectId, prepared.get(i) ?? []);
    if (photos.error) {
      await removePunchPhotos(supabase, uploaded);
      return { error: `Item ${i + 1}: ${photos.error}` };
    }
    uploaded.push(...photos.paths);
    const rowPriority = parsePriority(priorities[i]);
    rows.push({
      project_id: projectId,
      description: descriptions[i],
      source: "walkdown",
      location: locations[i] || null,
      responsible_party_id: responsibleParties[i] || null,
      due_date: resolvePunchDueDate(dueDates[i], rowPriority, siteDay),
      priority: rowPriority,
      photo_paths: photos.paths,
      created_by: user?.id ?? null,
      ...(walkdownId ? { walkdown_id: walkdownId } : {}),
      ...(requestId ? { client_request_id: `${requestId}-${i}` } : {}),
    });
  }

  type InsertedRow = { id: string; responsible_party_id: string | null; description: string };
  let { data: inserted, error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .insert(rows)
    .select("id, responsible_party_id, description")
    .returns<InsertedRow[]>();
  if (error && isMissingSchemaError(error)) {
    // walkdown_id / client_request_id columns not migrated yet: record the items without them.
    const plain = rows.map((r) => {
      const copy = { ...r };
      delete copy.walkdown_id;
      delete copy.client_request_id;
      return copy;
    });
    ({ data: inserted, error } = await supabase.from(PUNCH_LIST_ITEMS_TABLE).insert(plain).select("id, responsible_party_id, description").returns<InsertedRow[]>());
  }

  if (error) {
    await removePunchPhotos(supabase, uploaded);
    if (walkdownId) await supabase.from("walkdowns" as never).delete().eq("id", walkdownId);
    if (error.code === "23505") return { error: null, addedCount: rows.length };
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
        summary: `Walk-down recorded${walkdownArea ? ` (${walkdownArea})` : ""} — ${rows.length} punch item(s) added`,
      });
      for (const it of inserted ?? []) {
        await recordAuditEvent(supabase, {
          organizationId,
          projectId,
          entityType: "punch_list_item",
          entityId: it.id,
          action: "created",
          actorId: user?.id ?? null,
          summary: `Punch item added (walkdown): ${it.description}`,
        });
      }
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  // One party lookup per distinct party, not per item.
  const partyUsers = new Map<string, string | null>();
  for (const pid of new Set((inserted ?? []).map((it) => it.responsible_party_id).filter((p): p is string => !!p))) {
    partyUsers.set(pid, await partyUserId(supabase, pid));
  }
  for (const it of inserted ?? []) {
    await notifyUsers(
      supabase,
      projectId,
      user?.id ?? null,
      [it.responsible_party_id ? partyUsers.get(it.responsible_party_id) : null],
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
 *    add/updateItpItemMeasurementAction): source: 'itp_measurement_failure', sourceItpItemId.
 *
 * Manual entries go through addPunchItemAction (source: 'manual'); 'walkdown' items come from
 * recordWalkdownAction, which inserts directly (several rows per submit).
 *
 * created_by is the signed-in user (override with createdBy), priority defaults to B, and a
 * responsiblePartyId must belong to the project. The responsible party's user is notified.
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
  priority?: PunchListPriority;
  createdBy?: string | null;
  /** Reuse an existing non-closed item with the same source link instead of creating a second one. */
  dedupe?: boolean;
}): Promise<{ error: string | null; id?: string; existing?: boolean }> {
  if (!PUNCH_LIST_SOURCES.includes(params.source)) {
    return { error: "Invalid punch list source." };
  }
  if (params.dueDate && !validDueDate(params.dueDate)) {
    return { error: "Due date is not valid." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (params.responsiblePartyId && !(await partyBelongsToProject(supabase, params.projectId, params.responsiblePartyId))) {
    return { error: "The responsible party doesn't belong to this project." };
  }
  const priority: PunchListPriority = (PUNCH_LIST_PRIORITIES as readonly string[]).includes(params.priority ?? "")
    ? (params.priority as PunchListPriority)
    : "B";
  const createdBy = params.createdBy ?? user?.id ?? null;

  if (params.dedupe) {
    // One defect = one open item: a re-completed failing inspection (or a retry) reuses the open one.
    let existingQuery = supabase.from(PUNCH_LIST_ITEMS_TABLE).select("id").eq("project_id", params.projectId).neq("status", "closed").limit(1);
    if (params.sourceInspectionRecordId) existingQuery = existingQuery.eq("source_inspection_record_id", params.sourceInspectionRecordId);
    else if (params.sourceStandaloneAssignmentId) existingQuery = existingQuery.eq("source_standalone_assignment_id", params.sourceStandaloneAssignmentId);
    else if (params.sourceNcrId) existingQuery = existingQuery.eq("source_ncr_id", params.sourceNcrId);
    else if (params.sourceItpItemId) existingQuery = existingQuery.eq("source_itp_item_id", params.sourceItpItemId);
    const { data: found } = await existingQuery.maybeSingle<{ id: string }>();
    if (found) return { error: null, id: found.id, existing: true };
  }

  // Auto-created items default to a due date by priority so they can go overdue and escalate.
  const dueDate =
    params.dueDate ?? defaultPunchDueDate(priority, siteToday(new Date(), resolveSiteTimeZone(await fetchProjectTimeZone(supabase, params.projectId))));
  const itemPayload = {
    project_id: params.projectId,
    description: params.description,
    source: params.source,
    source_inspection_record_id: params.sourceInspectionRecordId ?? null,
    source_standalone_assignment_id: params.sourceStandaloneAssignmentId ?? null,
    source_ncr_id: params.sourceNcrId ?? null,
    source_itp_item_id: params.sourceItpItemId ?? null,
    location: params.location ?? null,
    responsible_party_id: params.responsiblePartyId ?? null,
    due_date: dueDate,
    priority,
    created_by: createdBy,
  };
  let { data: item, error } = await supabase.from(PUNCH_LIST_ITEMS_TABLE).insert(itemPayload).select("id").single<{ id: string }>();
  if (error && !item) {
    // One retry: a transient failure here would otherwise leave a failed inspection / NCR with no punch item.
    ({ data: item, error } = await supabase.from(PUNCH_LIST_ITEMS_TABLE).insert(itemPayload).select("id").single<{ id: string }>());
  }

  if (error || !item) {
    console.error("[punch] createPunchItemFromSource failed", params.source, error?.message);
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

  if (params.responsiblePartyId) {
    await notifyUsers(
      supabase,
      params.projectId,
      user?.id ?? null,
      [await partyUserId(supabase, params.responsiblePartyId)],
      item.id,
      "Punch item assigned to you",
      params.description
    );
  }

  revalidatePath(`/inspect/projects/${params.projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${params.projectId}/data-book`);
  return { error: null, id: item.id };
}

export interface WithdrawPunchState {
  error: string | null;
  done?: boolean;
}

/**
 * Withdraws a punch item raised in error or as a duplicate (S5-17): closed with a mandatory reason
 * and flagged withdrawn, so it stops blocking the Data Book. An NCR-sourced item is withdrawn with
 * its NCR instead (withdrawNcrAction) so the two never drift.
 */
export async function withdrawPunchItemAction(_prev: WithdrawPunchState, formData: FormData): Promise<WithdrawPunchState> {
  const punchItemId = String(formData.get("punch_item_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!punchItemId || !projectId) return { error: "Missing punch item." };
  if (reason.length < 5) return { error: "Give a reason for withdrawing this item (at least 5 characters)." };
  if (reason.length > PUNCH_MAX_DESCRIPTION) return { error: `Reason is too long (max ${PUNCH_MAX_DESCRIPTION} characters).` };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: cur } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("status, created_by, source_ncr_id, description")
    .eq("id", punchItemId)
    .eq("project_id", projectId)
    .maybeSingle<{ status: string; created_by: string | null; source_ncr_id: string | null; description: string }>();
  if (!cur) return { error: "This punch item could not be found." };
  if (cur.status === "closed") return { error: "This item is already closed." };
  if (cur.source_ncr_id) return { error: "This item belongs to an NCR - withdraw the NCR to withdraw its punch item." };
  const allowed = session.isJagsStaff || isAdminStaff(session) || cur.created_by === session.userId || (await hasPermission(session.userId, "close_punch_item", projectId));
  if (!allowed) return { error: "Only the creator, JAGS staff or a punch item verifier can withdraw an item." };

  const now = new Date().toISOString();
  const note = `Withdrawn: ${reason}`;
  const { data, error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update({
      status: "closed",
      closing_evidence: note,
      verification_notes: note,
      withdrawn_at: now,
      withdrawn_by: session.userId,
      withdrawn_reason: reason,
      closed_by: session.userId,
      closed_at: now,
    })
    .eq("id", punchItemId)
    .eq("project_id", projectId)
    .neq("status", "closed")
    .select("id")
    .returns<{ id: string }[]>();
  if (error) {
    if (isMissingSchemaError(error)) return { error: "Withdrawing needs the latest database update, which has not been applied yet. Ask an administrator." };
    return { error: error.code === "P0001" && error.message ? error.message : "Could not withdraw the punch item." };
  }
  if (!data || data.length === 0) return { error: "This item changed meanwhile - refresh and try again." };

  try {
    const organizationId = await findOrgForProject(supabase, projectId);
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "punch_list_item",
        entityId: punchItemId,
        action: "withdrawn",
        actorId: session.userId,
        summary: `Punch item withdrawn: ${reason}`,
        changes: { reason },
      });
    }
  } catch {
    // Best-effort.
  }
  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null, done: true };
}

export interface BulkPunchState {
  error: string | null;
  updated?: number;
}

/**
 * Bulk reassign / re-date / re-prioritise selected punch items (S5-23). Same authority as editing one
 * item (JAGS admin or close_punch_item holder); closed items are skipped; every change is audited.
 */
export async function bulkUpdatePunchItemsAction(_prev: BulkPunchState, formData: FormData): Promise<BulkPunchState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const ids = [...new Set(formData.getAll("item_id").map((v) => String(v).trim()).filter(Boolean))];
  const partyRaw = formData.get("responsible_party_id");
  const dueRaw = String(formData.get("due_date") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "").trim().toUpperCase();
  if (!projectId || ids.length === 0) return { error: "Select at least one item." };
  if (ids.length > 200) return { error: "Select at most 200 items at a time." };
  if (!validDueDate(dueRaw)) return { error: "Due date is not valid." };
  if (priorityRaw && !(PUNCH_LIST_PRIORITIES as readonly string[]).includes(priorityRaw)) return { error: "Priority is not valid." };

  const patch: Record<string, unknown> = {};
  if (partyRaw !== null && String(partyRaw) !== "__keep") patch.responsible_party_id = String(partyRaw).trim() || null;
  if (dueRaw) patch.due_date = dueRaw;
  if (priorityRaw) patch.priority = priorityRaw;
  if (Object.keys(patch).length === 0) return { error: "Choose something to change." };

  const session = await requireSession();
  const allowed = isAdminStaff(session) || (await hasPermission(session.userId, "close_punch_item", projectId));
  if (!allowed) return { error: "Only a JAGS Admin, or someone granted the verify permission, can change several items at once." };
  const supabase = await createSupabaseServerClient();
  if (typeof patch.responsible_party_id === "string" && !(await partyBelongsToProject(supabase, projectId, patch.responsible_party_id))) {
    return { error: "The responsible party doesn't belong to this project." };
  }

  const { data, error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update(patch)
    .eq("project_id", projectId)
    .in("id", ids)
    .neq("status", "closed")
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: error.code === "P0001" && error.message ? error.message : "Could not update the selected items." };
  const updated = (data ?? []).length;

  try {
    const organizationId = await findOrgForProject(supabase, projectId);
    if (organizationId && updated > 0) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "punch_list_item",
        entityId: projectId,
        action: "bulk_updated",
        actorId: session.userId,
        summary: `${updated} punch item(s) updated together (${Object.keys(patch).join(", ")})`,
        changes: { ...patch, item_ids: (data ?? []).map((d) => d.id) },
      });
    }
    if (typeof patch.responsible_party_id === "string" && updated > 0) {
      await notifyUsers(supabase, projectId, session.userId, await partyUsers(supabase, patch.responsible_party_id), (data ?? [])[0].id, "Punch items assigned to you", `${updated} punch item(s) were assigned to your organisation.`);
    }
  } catch {
    // Best-effort.
  }
  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null, updated };
}

export interface SignOffWalkdownState {
  error: string | null;
  done?: boolean;
}

/** S5-23: the walkdown's recorder (or an admin) signs the walkdown off as a complete, reviewed record. */
export async function signOffWalkdownAction(_prev: SignOffWalkdownState, formData: FormData): Promise<SignOffWalkdownState> {
  const walkdownId = String(formData.get("walkdown_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!walkdownId || !projectId) return { error: "Missing walkdown." };
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: wd, error: readErr } = await supabase
    .from("walkdowns" as never)
    .select("id, created_by, signed_off_at, item_count, area, walked_on")
    .eq("id", walkdownId)
    .eq("project_id", projectId)
    .maybeSingle<{ id: string; created_by: string | null; signed_off_at: string | null; item_count: number; area: string | null; walked_on: string }>();
  if (readErr) return { error: isMissingSchemaError(readErr) ? "Walkdown records need a database update that has not been applied yet." : "Could not read the walkdown." };
  if (!wd) return { error: "Walkdown not found." };
  const problem = walkdownSignOffError({
    isCreator: wd.created_by === session.userId,
    isAdmin: isAdminStaff(session),
    alreadySigned: !!wd.signed_off_at,
    itemCount: wd.item_count,
  });
  if (problem) return { error: problem };

  const { data: updated, error } = await supabase
    .from("walkdowns" as never)
    .update({ signed_off_by: session.userId, signed_off_at: new Date().toISOString() } as never)
    .eq("id", walkdownId)
    .is("signed_off_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) return { error: "Could not sign off the walkdown. Check you have permission and try again." };
  if (!updated) return { error: "This walkdown was already signed off." };

  try {
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
    if (project) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "walkdown",
        entityId: walkdownId,
        action: "signed_off",
        actorId: session.userId,
        summary: `Walkdown signed off${wd.area ? ` (${wd.area})` : ""} - ${wd.item_count} item(s), walked ${wd.walked_on}`,
      });
    }
  } catch {
    // Best-effort audit.
  }
  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  return { error: null, done: true };
}
