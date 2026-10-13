"use server";

import type { FieldErrors } from "@/lib/forms/field-errors";
import { parseRequiredRegisters } from "./required-registers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateDocumentNumber, NumberingError } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";
import { mergeItpTranslation } from "@/lib/itps/translations";
import { generateChecklistsForItp } from "@/lib/checklists/actions";
import { hasPermission } from "@/lib/rbac/permissions";
import { recordAuditEvent } from "@/lib/audit/log";
import { checklistReviewError, recordChecklistReviewTick } from "@/lib/itps/checklist-review";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { bumpRevisionIfIssued, snapshotInitialIssue, snapshotApprovedRevision, type BumpResult } from "@/lib/itps/revisions";
import { itemDeleteBlocker } from "@/lib/itps/guards";
import { approvePermissionStrict, mayApproveItp, revisionApprovalRecipients } from "@/lib/itps/lifecycle";
import { parseBulkActivityRows } from "@/lib/itps/bulk-import";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE, type ItpApprovalWorkflowConfigRow } from "@/lib/itp-approval-workflow/types";
import { startReviewChainForItp, getItpReviewProgress, archiveReviewChain, ITP_REVIEW_PROGRESS_TABLE } from "@/lib/itps/review-chain";
import { assertAiAllowed } from "@/lib/ai/gate";
import { aiErrorMessage } from "@/lib/ai/config";
import { logAiUsage } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import { safeDbMessage } from "@/lib/errors/safe-message";

// Default section structure from the Requirements doc (R24 examples) — a starting point the user
// can add to, rename, or reorder; sections are explicitly not fixed.
const DEFAULT_SECTIONS = [
  { section_number: 1, title: "Submittals & Materials" },
  { section_number: 2, title: "Installation / Execution" },
  { section_number: 3, title: "Testing & Commissioning" },
  { section_number: 4, title: "Handover" },
];

export interface CreateItpState {
  error: string | null;
  /** Per-input problems (keys are form field names), shown next to the field; `error` stays the fallback. */
  fieldErrors?: FieldErrors;
}

export async function createItpAction(_prev: CreateItpState, formData: FormData): Promise<CreateItpState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const itpNumberOverride = String(formData.get("itp_number") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const applicableStandard = String(formData.get("applicable_standard") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();

  if (!projectId || !title) {
    return {
      error: "Project and title are required.",
      fieldErrors: {
        ...(projectId ? {} : { project_id: "Select a project." }),
        ...(title ? {} : { title: "Title is required." }),
      },
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only JAGS staff may force a specific ITP number; everyone else gets the numbering engine's
  // next number so the project's numbering convention can't be broken by a typed override.
  const { data: callerProfile } = await supabase
    .from("users")
    .select("is_jags_staff")
    .eq("id", user?.id ?? "")
    .maybeSingle<{ is_jags_staff: boolean }>();
  const effectiveNumberOverride = callerProfile?.is_jags_staff ? itpNumberOverride : "";

  const { data: project } = await supabase
    .from("projects")
    .select("project_number, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ project_number: string; organization_id: string }>();

  if (!project) {
    return { error: "Project not found." };
  }

  // Auto-generated via the same numbering engine every other document type uses (client's own
  // numbering format if configured, else a sensible default) — a manual override is still accepted
  // for the rare case a specific number needs to be forced (e.g. matching a legacy/external scheme).
  let itpNumber = effectiveNumberOverride;
  let releaseItpNumber: (() => Promise<void>) | undefined;
  if (!itpNumber) {
    try {
      const generated = await generateDocumentNumber(supabase, {
        organizationId: project.organization_id,
        projectId,
        docType: "itp",
        projectNumber: project.project_number,
      });
      itpNumber = generated.documentNumber;
      releaseItpNumber = generated.releaseNumber;
    } catch (err) {
      if (err instanceof NumberingError) return { error: err.message };
      throw err;
    }
  }

  const { data: itp, error } = await supabase
    .from("itps")
    .insert({
      project_id: projectId,
      itp_number: itpNumber,
      title,
      applicable_standard: applicableStandard || null,
      scope: scope || null,
      prepared_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !itp) {
    // A failed save must not leave a gap in the numbering (B3). Not for a duplicate: that number is in use.
    if (error?.code !== "23505") await releaseItpNumber?.();
    if (error?.code === "23505") {
      return { error: "An ITP with that number already exists for this project.", fieldErrors: { itp_number: "An ITP with that number already exists for this project." } };
    }
    return { error: "Could not create the ITP. Check you have permission and try again." };
  }

  const { error: sectionsError } = await supabase
    .from("itp_sections")
    .insert(DEFAULT_SECTIONS.map((s, i) => ({ itp_id: itp.id, sort_order: i, ...s })));

  if (sectionsError) {
    // Don't leave an empty draft holding the number: remove it so the user can simply retry.
    await supabase.from("itps").delete().eq("id", itp.id);
    await releaseItpNumber?.();
    return { error: "The ITP could not be created because its default sections could not be added. Nothing was saved — please try again." };
  }

  // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
  // creation above — see lib/audit/log.ts's doc comment.
  await recordAuditEvent(supabase, {
    organizationId: project.organization_id,
    projectId,
    entityType: "itp",
    entityId: itp.id,
    action: "created",
    actorId: user?.id ?? null,
    summary: `ITP ${itpNumber} created`,
  });

  redirect(`/inspect/itps/${itp.id}`);
}

/**
 * Content edited while an ITP is UNDER REVIEW means reviewers who already signed approved something
 * different from what is now on the page. Reset every review step to pending (the review starts over),
 * record why in the audit trail, and tell the reviewer whose turn it now is. No-op in any other status.
 */
async function resetReviewIfUnderReview(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpId: string,
  summary: string,
  actorId: string | null
): Promise<void> {
  try {
    const { data: itp } = await supabase
      .from("itps")
      .select("status, itp_number, project_id, projects(organization_id)")
      .eq("id", itpId)
      .maybeSingle<{ status: string; itp_number: string; project_id: string; projects: { organization_id: string } | null }>();
    if (!itp || itp.status !== "under_review") return;

    const { data: signed } = await supabase
      .from(ITP_REVIEW_PROGRESS_TABLE)
      .select("id")
      .eq("itp_id", itpId)
      .eq("status", "approved");
    if (!signed?.length) return;

    const { error: resetError } = await supabase
      .from(ITP_REVIEW_PROGRESS_TABLE)
      .update({ status: "pending", reviewed_at: null })
      .eq("itp_id", itpId)
      .eq("status", "approved");

    if (itp.projects?.organization_id) {
      // A failed reset leaves approvals standing over changed content: say so loudly in the audit trail.
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: resetError ? "review_reset_failed" : "review_reset_after_edit",
        actorId,
        summary: resetError
          ? `${itp.itp_number} edited during review (${summary}) — review sign-offs COULD NOT be reset; re-review is needed`
          : `${itp.itp_number} edited during review (${summary}) — review sign-offs reset`,
      });
      // Tell the reviewer whose turn it now is.
      const { data: first } = await supabase
        .from(ITP_REVIEW_PROGRESS_TABLE)
        .select("reviewer_user_id")
        .eq("itp_id", itpId)
        .eq("status", "pending")
        .order("sort_order")
        .limit(1)
        .maybeSingle<{ reviewer_user_id: string }>();
      if (first && first.reviewer_user_id !== actorId) {
        await createNotification(supabase, {
          organizationId: itp.projects.organization_id,
          projectId: itp.project_id,
          recipientUserId: first.reviewer_user_id,
          title: `${itp.itp_number} changed during review`,
          body: `${summary} — please review it again`,
          link: `/inspect/itps/${itpId}`,
        });
      }
    }
  } catch {
    // Best-effort — never blocks the edit that already succeeded.
  }
}

/** Resolves an item's real ITP (never trust the posted itp_id) with its status and organisation. */
async function resolveItemItp(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, itemId: string) {
  const { data } = await supabase
    .from("itp_items")
    .select("id, section_id, item_number, activity, itp_sections(itp_id, itps(status, project_id, projects(organization_id)))")
    .eq("id", itemId)
    .maybeSingle<{
      id: string;
      section_id: string;
      item_number: string;
      activity: string;
      itp_sections: { itp_id: string; itps: { status: string; project_id: string; projects: { organization_id: string } | null } | null } | null;
    }>();
  const itp = data?.itp_sections?.itps;
  if (!data || !itp) return null;
  return {
    itemId: data.id,
    sectionId: data.section_id,
    itemNumber: data.item_number,
    activity: data.activity,
    itpId: data.itp_sections!.itp_id,
    status: itp.status,
    projectId: itp.project_id,
    organizationId: itp.projects?.organization_id ?? null,
  };
}


export interface AddItemState {
  error: string | null;
}

function parsePlannedDate(raw: FormDataEntryValue | null): { value: string | null; error: string | null } {
  const s = String(raw ?? "").trim();
  if (!s) return { value: null, error: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    return { value: null, error: "Planned date must be a valid date." };
  }
  return { value: s, error: null };
}

export async function addItpItemAction(_prev: AddItemState, formData: FormData): Promise<AddItemState> {
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const itemNumber = String(formData.get("item_number") ?? "").trim();
  const activity = String(formData.get("activity") ?? "").trim();
  const acceptanceCriteria = String(formData.get("acceptance_criteria") ?? "").trim();
  const evidenceType = Number(formData.get("evidence_type") ?? 1);
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();
  const governingDrawingDocumentId = String(formData.get("governing_drawing_document_id") ?? "").trim();
  const referenceSpec = String(formData.get("reference_spec") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();
  // R25: optional per-activity override of the notice-period hours otherwise resolved from the
  // project/org/built-in fallback chain — see getNoticePeriodHours in lib/signoff/actions.ts. Blank
  // (the common case) leaves it unset so that existing resolution is unaffected.
  const noticeHoursOverrideRaw = String(formData.get("notice_hours_override") ?? "").trim();
  let noticeHoursOverride: number | null = null;
  if (noticeHoursOverrideRaw) {
    const parsed = Number.parseInt(noticeHoursOverrideRaw, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return { error: "Notice hours override must be a non-negative whole number, or left blank." };
    }
    noticeHoursOverride = parsed;
  }

  const plannedParsed = parsePlannedDate(formData.get("planned_date"));
  if (plannedParsed.error) return { error: plannedParsed.error };

  if (!sectionId || !itemNumber || !activity) {
    return { error: "Item number and activity are required." };
  }

  const supabase = await createSupabaseServerClient();

  // The section must really belong to the posted ITP (the revision logic below keys on itpId), and an
  // item number can only be used once per section.
  const { data: sectionRow } = await supabase
    .from("itp_sections")
    .select("itp_id")
    .eq("id", sectionId)
    .maybeSingle<{ itp_id: string }>();
  if (!sectionRow || sectionRow.itp_id !== itpId) {
    return { error: "That section doesn't belong to this ITP." };
  }
  const { count: sameNumber } = await supabase
    .from("itp_items")
    .select("id", { count: "exact", head: true })
    .eq("section_id", sectionId)
    .eq("item_number", itemNumber);
  if (sameNumber) {
    return { error: `Activity number ${itemNumber} is already used in this section — choose a different number.` };
  }

  // R101: itp_items_write RLS lets JAGS staff add an item to an ITP at any status (a client's own
  // is_client_itp_creator path is draft-only, so this is the only edit reachable after issue). Adding
  // an item to an already-approved/client-accepted ITP is exactly the "edit after issue" this
  // requirement targets — freeze the pre-edit content as history and bump the revision counter before
  // applying it, rather than letting an issued document change silently with no record.
  const { data: itpForRevisionCheck } = await supabase
    .from("itps")
    .select("status, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ status: string; project_id: string; projects: { organization_id: string } | null }>();
  const isIssued = itpForRevisionCheck?.status === "approved" || itpForRevisionCheck?.status === "client_accepted";
  if (itpForRevisionCheck?.status === "superseded" || itpForRevisionCheck?.status === "withdrawn") {
    return { error: `This ITP is ${itpForRevisionCheck.status} and can no longer be edited.` };
  }
  let addBump: BumpResult | null = null;

  if (isIssued) {
    if (!revisionReason) {
      return { error: "This ITP has already been issued — a reason is required to add an activity and create a new revision." };
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    addBump = await bumpRevisionIfIssued(
      supabase,
      itpId,
      `Added activity ${itemNumber}: ${activity} — ${revisionReason}`,
      user?.id ?? null
    );
    if (addBump.error) return { error: addBump.error };
  }

  // itp_items.sort_order defaults to 0 in the schema, and this was the only item-creation path that
  // never set it (the AI-draft and master-template-clone paths both assign sort_order: i on insert —
  // see ai-draft-actions.ts and itp-master/actions.ts). Every manually-added item was landing at 0,
  // so once a section had more than one, display order fell back to whatever order Postgrest's
  // embedded-resource query happened to return — not necessarily the item_number sequence the
  // inspector actually typed. Appending after the current highest sort_order in this section keeps
  // manually-added items in the order they were added, matching the other two creation paths.
  const { data: lastItem } = await supabase
    .from("itp_items")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (lastItem?.sort_order ?? -1) + 1;

  const { data: newItem, error } = await supabase.from("itp_items").insert({
    section_id: sectionId,
    item_number: itemNumber,
    activity,
    acceptance_criteria: acceptanceCriteria || null,
    evidence_type: evidenceType === 2 || evidenceType === 3 ? evidenceType : 1,
    discipline_id: disciplineId || null,
    // R103: optional link to the vault "Drawings" document that governs this activity — frozen
    // onto inspection_records at inspection start (see startInspectionAction). Not enforced to
    // actually be in the drawings folder here; the picker only offers those (add-item-form.tsx).
    governing_drawing_document_id: governingDrawingDocumentId || null,
    reference_spec: referenceSpec || null,
    method: method || null,
    frequency: frequency || null,
    notice_hours_override: noticeHoursOverride,
    planned_date: plannedParsed.value,
    sort_order: nextSortOrder,
  }).select("id").single<{ id: string }>();

  if (error || !newItem) {
    await addBump?.undo?.();
    return { error: "Could not add the activity. Check you have permission and try again." };
  }

  // Sign-off levels chosen on the add form (one optional select per party). The database validates
  // each code against the organisation's configured levels and creates the sign-off rows itself.
  const chosenInterventions = [...formData.entries()]
    .filter(([key, value]) => key.startsWith("intervention__") && String(value).trim() !== "")
    .map(([key, value]) => ({
      itp_item_id: newItem.id,
      project_party_id: key.slice("intervention__".length),
      intervention: String(value).trim(),
    }));
  if (chosenInterventions.length > 0) {
    const { error: interventionError } = await supabase.from("activity_party_intervention").insert(chosenInterventions);
    if (interventionError) {
      revalidatePath(`/inspect/itps/${itpId}`);
      return { error: "The activity was added, but its sign-off levels could not be saved — set them in the grid below." };
    }
  }

  await resetReviewIfUnderReview(supabase, itpId, `activity ${itemNumber} added`, null);

  // An activity added to an already-issued ITP would otherwise have no checklist until someone found the
  // manual "generate" button. Generation is idempotent (it skips activities that already have one).
  if (isIssued && evidenceType !== 2 && evidenceType !== 3 && itpForRevisionCheck?.projects?.organization_id) {
    try {
      const {
        data: { user: generatorUser },
      } = await supabase.auth.getUser();
      const { data: itpNumberRow } = await supabase.from("itps").select("itp_number").eq("id", itpId).maybeSingle<{ itp_number: string }>();
      await generateChecklistsForItp(supabase, {
        itpId,
        itpNumber: itpNumberRow?.itp_number ?? "",
        projectId: itpForRevisionCheck.project_id,
        organizationId: itpForRevisionCheck.projects.organization_id,
        userId: generatorUser?.id ?? null,
      });
    } catch {
      // Best-effort — the checklist can still be generated manually.
    }
  }

  // Found missing in a self-review audit: ITP content-authoring actions (add/edit/delete item, set
  // intervention) had no audit trail at all, unlike every status-transition action on this same ITP
  // — best-effort, never blocks the write above, which already succeeded.
  const organizationId = itpForRevisionCheck?.projects?.organization_id;
  if (organizationId) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itpForRevisionCheck?.project_id ?? undefined,
        entityType: "itp_item",
        entityId: itpId,
        action: "item_added",
        actorId: user?.id ?? null,
        summary: `Activity ${itemNumber} added: ${activity}`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export interface BulkAddItemsState {
  error: string | null;
  added?: number;
}

/**
 * Adds many activities to one section at once from pasted spreadsheet rows (tab- or comma-separated):
 * Item no. | Activity | Acceptance criteria | Reference spec/clause | Method | Frequency. The item number
 * may be left blank to auto-number. Duplicates (within the paste, or already in the section) are
 * rejected up front so nothing is half-added.
 */
export async function bulkAddItpItemsAction(_prev: BulkAddItemsState, formData: FormData): Promise<BulkAddItemsState> {
  const sectionId = String(formData.get("section_id") ?? "").trim();
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const pasted = String(formData.get("rows") ?? "");
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();
  if (!sectionId || !itpId) return { error: "Missing section." };

  if (pasted.length > 400_000) return { error: "That paste is too large." };

  const supabase = await createSupabaseServerClient();
  const { data: itpHead } = await supabase.from("itps").select("project_id").eq("id", itpId).maybeSingle<{ project_id: string }>();
  if (!itpHead) return { error: "ITP not found." };
  const { data: partyRows } = await supabase
    .from("project_parties")
    .select("id, name")
    .eq("project_id", itpHead.project_id)
    .eq("is_active", true)
    .returns<{ id: string; name: string }[]>();
  const parsed = parseBulkActivityRows(pasted, (partyRows ?? []).map((p) => p.name));
  if (parsed.error) return { error: parsed.error };
  if (parsed.rows.length > 200) return { error: "Paste up to 200 rows at a time." };
  const lines = parsed.rows;
  const { data: sectionRow } = await supabase
    .from("itp_sections")
    .select("itp_id, section_number")
    .eq("id", sectionId)
    .maybeSingle<{ itp_id: string; section_number: number }>();
  if (!sectionRow || sectionRow.itp_id !== itpId) return { error: "That section doesn't belong to this ITP." };

  const { data: existing } = await supabase
    .from("itp_items")
    .select("item_number, sort_order")
    .eq("section_id", sectionId)
    .returns<{ item_number: string; sort_order: number }[]>();
  const usedNumbers = new Set((existing ?? []).map((i) => i.item_number));
  let nextSort = Math.max(-1, ...(existing ?? []).map((i) => i.sort_order)) + 1;
  let autoCounter = (existing ?? []).length;

  const rows: {
    section_id: string;
    item_number: string;
    activity: string;
    acceptance_criteria: string | null;
    reference_spec: string | null;
    method: string | null;
    frequency: string | null;
    evidence_type: number;
    planned_date: string | null;
    sort_order: number;
  }[] = [];
  const levelsByNumber = new Map<string, Record<string, string>>();
  for (const [index, line] of lines.entries()) {
    const numberRaw = line.itemNumber;
    const activityRaw = line.activity;
    const criteriaRaw = line.acceptanceCriteria ?? "";
    const referenceRaw = line.referenceSpec ?? "";
    const methodRaw = line.method ?? "";
    const frequencyRaw = line.frequency ?? "";
    let itemNumber = numberRaw;
    if (!itemNumber) {
      do {
        autoCounter += 1;
        itemNumber = `${sectionRow.section_number}.${autoCounter}`;
      } while (usedNumbers.has(itemNumber));
    }
    if (usedNumbers.has(itemNumber)) return { error: `Row ${index + 1}: activity number ${itemNumber} is already used in this section.` };
    usedNumbers.add(itemNumber);
    rows.push({
      section_id: sectionId,
      item_number: itemNumber,
      activity: activityRaw,
      acceptance_criteria: criteriaRaw || null,
      reference_spec: referenceRaw || null,
      method: methodRaw || null,
      frequency: frequencyRaw || null,
      evidence_type: line.evidenceType,
      planned_date: line.plannedDate,
      sort_order: nextSort++,
    });
    if (Object.keys(line.levels).length > 0) levelsByNumber.set(itemNumber, line.levels);
  }

  const { data: itp } = await supabase
    .from("itps")
    .select("status, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ status: string; project_id: string; projects: { organization_id: string } | null }>();
  const isIssued = itp?.status === "approved" || itp?.status === "client_accepted";
  let bulkBump: BumpResult | null = null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (isIssued) {
    if (!revisionReason) return { error: "This ITP has already been issued — a reason is required to add activities and create a new revision." };
    bulkBump = await bumpRevisionIfIssued(supabase, itpId, `Added ${rows.length} activities (bulk) — ${revisionReason}`, user?.id ?? null);
    if (bulkBump.error) return { error: bulkBump.error };
  }
  if (itp?.status === "superseded" || itp?.status === "withdrawn") return { error: `This ITP is ${itp.status} and can no longer be edited.` };

  const { data: insertedItems, error } = await supabase.from("itp_items").insert(rows).select("id, item_number");
  if (error || !insertedItems) {
    await bulkBump?.undo?.();
    return { error: "Could not add the activities. Check you have permission and try again — nothing was added." };
  }

  // Sign-off levels given per party column (validated by the database against the org's configured levels).
  const partyIdByName = new Map((partyRows ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));
  const levelRows = insertedItems.flatMap((it) =>
    Object.entries(levelsByNumber.get(it.item_number) ?? {}).flatMap(([partyName, code]) => {
      const partyId = partyIdByName.get(partyName.trim().toLowerCase());
      return partyId ? [{ itp_item_id: it.id, project_party_id: partyId, intervention: code }] : [];
    })
  );
  let levelWarning: string | undefined;
  if (levelRows.length > 0) {
    const { error: levelError } = await supabase.from("activity_party_intervention").insert(levelRows);
    if (levelError) levelWarning = "The activities were added, but some sign-off levels were rejected (check the level codes) — set them in the grid.";
  }

  // Checklist-type activities added to an issued ITP get their checklist now, like single add does.
  if (isIssued && itp?.projects?.organization_id && rows.some((r) => r.evidence_type === 1)) {
    try {
      const { data: numberRow } = await supabase.from("itps").select("itp_number").eq("id", itpId).maybeSingle<{ itp_number: string }>();
      await generateChecklistsForItp(supabase, {
        itpId,
        itpNumber: numberRow?.itp_number ?? "",
        projectId: itp.project_id,
        organizationId: itp.projects.organization_id,
        userId: user?.id ?? null,
      });
    } catch {
      // Best-effort — the checklist can still be generated manually.
    }
  }

  await resetReviewIfUnderReview(supabase, itpId, `${rows.length} activities added`, null);
  if (itp?.projects?.organization_id) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp_item",
        entityId: itpId,
        action: "items_bulk_added",
        actorId: user?.id ?? null,
        summary: `${rows.length} activities added in bulk`,
      });
    } catch {
      // Best-effort.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: levelWarning ?? null, added: rows.length };
}

export interface EditItemState {
  error: string | null;
}

/**
 * Edit an existing ITP item — previously the grid only supported Add, with no way to fix a typo or
 * change an activity's details short of the staff-only offline .xlsx re-upload (see
 * lib/itps/offline-revision-actions.ts). Mirrors addItpItemAction's R101 edit-after-issue pattern
 * exactly (revision reason required once issued, pre-edit content frozen into history first) —
 * itp_items_write_u RLS already allowed this; only the app action and UI button were missing.
 */
export async function editItpItemAction(_prev: EditItemState, formData: FormData): Promise<EditItemState> {
  const itemId = String(formData.get("item_id") ?? "").trim();
  const itemNumber = String(formData.get("item_number") ?? "").trim();
  const activity = String(formData.get("activity") ?? "").trim();
  const acceptanceCriteria = String(formData.get("acceptance_criteria") ?? "").trim();
  const evidenceType = Number(formData.get("evidence_type") ?? 1);
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();
  const referenceSpec = String(formData.get("reference_spec") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();
  const noticeHoursOverrideRaw = String(formData.get("notice_hours_override") ?? "").trim();
  let noticeHoursOverride: number | null = null;
  if (noticeHoursOverrideRaw) {
    const parsed = Number.parseInt(noticeHoursOverrideRaw, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return { error: "Notice hours override must be a non-negative whole number, or left blank." };
    }
    noticeHoursOverride = parsed;
  }

  const plannedParsed = parsePlannedDate(formData.get("planned_date"));
  if (plannedParsed.error) return { error: plannedParsed.error };

  if (!itemId || !itemNumber || !activity) {
    return { error: "Item number and activity are required." };
  }

  const supabase = await createSupabaseServerClient();

  // Use the item's REAL ITP, not the posted one, so a forged itp_id can't dodge the revision logic.
  const resolved = await resolveItemItp(supabase, itemId);
  if (!resolved) return { error: "Activity not found, or you don't have access to it." };
  const itpId = resolved.itpId;
  const { count: duplicateNumber } = await supabase
    .from("itp_items")
    .select("id", { count: "exact", head: true })
    .eq("section_id", resolved.sectionId)
    .eq("item_number", itemNumber)
    .neq("id", itemId);
  if (duplicateNumber) {
    return { error: `Activity number ${itemNumber} is already used in this section — choose a different number.` };
  }

  const { data: itpForRevisionCheck } = await supabase
    .from("itps")
    .select("status, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ status: string; project_id: string; projects: { organization_id: string } | null }>();
  const isIssued = itpForRevisionCheck?.status === "approved" || itpForRevisionCheck?.status === "client_accepted";
  if (itpForRevisionCheck?.status === "superseded" || itpForRevisionCheck?.status === "withdrawn") return { error: `This ITP is ${itpForRevisionCheck.status} and can no longer be edited.` };
  let editBump: BumpResult | null = null;

  if (isIssued) {
    if (!revisionReason) {
      return { error: "This ITP has already been issued — a reason is required to edit an activity and create a new revision." };
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    editBump = await bumpRevisionIfIssued(
      supabase,
      itpId,
      `Edited activity ${itemNumber}: ${activity} — ${revisionReason}`,
      user?.id ?? null
    );
    if (editBump.error) return { error: editBump.error };
  }

  // Editing an activity's drawing: the field is only changed when the form sends it (older forms don't).
  // S3-06: the explicit register requirement; only changed when the form sends it (older forms don't).
  const registersSent = formData.has("registers_sent");
  const requiredRegisters = parseRequiredRegisters(formData.getAll("required_registers"));
  const drawingFieldSent = formData.has("governing_drawing_document_id");
  const drawingId = String(formData.get("governing_drawing_document_id") ?? "").trim();
  const { data: previousItem } = await supabase.from("itp_items").select("evidence_type").eq("id", itemId).maybeSingle<{ evidence_type: number }>();

  const { data: updatedItems, error } = await supabase
    .from("itp_items")
    .update({
      ...(drawingFieldSent ? { governing_drawing_document_id: drawingId || null } : {}),
      // required_registers isn't in the generated Database type yet (same cast as lib/registers/verify.ts).
      ...(registersSent ? ({ required_registers: requiredRegisters } as unknown as object) : {}),
      item_number: itemNumber,
      activity,
      acceptance_criteria: acceptanceCriteria || null,
      evidence_type: evidenceType === 2 || evidenceType === 3 ? evidenceType : 1,
      discipline_id: disciplineId || null,
      reference_spec: referenceSpec || null,
      method: method || null,
      frequency: frequency || null,
      notice_hours_override: noticeHoursOverride,
      planned_date: plannedParsed.value,
    })
    .eq("id", itemId)
    .select("id");

  if (error || !updatedItems?.length) {
    await editBump?.undo?.();
    return { error: error?.code === "23505" ? `Activity number ${itemNumber} is already used in this section.` : "Could not update the activity. Check you have permission and try again." };
  }

  // Switching an activity away from "checklist" leaves its checklist template behind, still counted as
  // outstanding by readiness. Say so instead of leaving a silent orphan.
  let evidenceNote: string | null = null;
  if (previousItem && previousItem.evidence_type === 1 && (evidenceType === 2 || evidenceType === 3)) {
    const { count: templateCount } = await supabase
      .from("checklist_templates" as never)
      .select("id", { count: "exact", head: true })
      .eq("itp_item_id" as never, itemId as never);
    if (templateCount) {
      evidenceNote = "Saved. This activity still has a checklist from when it was a checklist-type activity — it is no longer used, so review or remove it under the ITP's checklists.";
    }
  }

  await resetReviewIfUnderReview(supabase, itpId, `activity ${itemNumber} edited`, null);

  const organizationId = itpForRevisionCheck?.projects?.organization_id;
  if (organizationId) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itpForRevisionCheck?.project_id ?? undefined,
        entityType: "itp_item",
        entityId: itemId,
        action: "item_edited",
        actorId: user?.id ?? null,
        summary: `Activity ${itemNumber} edited: ${activity}`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: evidenceNote };
}

/**
 * Delete an ITP item — cascades to activity_party_intervention and activity_signoff_progress
 * (ON DELETE CASCADE on itp_item_id, supabase/migrations/20260909230000_phase1_itp_core.sql /
 * 20260910000000_phase1_signoff_chain.sql), so any sign-off state on this activity goes with it.
 * Same R101 edit-after-issue gate as deleteItpSectionAction — fire-and-forget void action, same
 * shape as that function, since there's no persistent form to surface an error message in beyond
 * the confirm()/prompt() the caller already runs.
 */
export interface DeleteItemState {
  error: string | null;
}

export async function deleteItpItemAction(_prev: DeleteItemState, formData: FormData): Promise<DeleteItemState> {
  const itemId = String(formData.get("item_id") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();
  if (!itemId) return { error: "Missing activity." };

  const supabase = await createSupabaseServerClient();

  const resolved = await resolveItemItp(supabase, itemId);
  if (!resolved) return { error: "Activity not found, or you don't have access to it." };
  const itpId = resolved.itpId;

  // An activity with real execution history (inspections, signed points, NCRs, evidence) is never
  // deleted — the foreign keys cascade, so deleting it would wipe signed-off QA records.
  const blocker = await itemDeleteBlocker(supabase, itemId);
  if (blocker) return { error: blocker };

  if (resolved.status === "superseded" || resolved.status === "withdrawn") return { error: `This ITP is ${resolved.status} and can no longer be edited.` };
  const isIssued = resolved.status === "approved" || resolved.status === "client_accepted";
  let deleteBump: BumpResult | null = null;
  if (isIssued) {
    if (!revisionReason) return { error: "This ITP has already been issued — a reason is required to delete an activity." };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    deleteBump = await bumpRevisionIfIssued(
      supabase,
      itpId,
      `Deleted activity ${resolved.itemNumber}: ${resolved.activity} — ${revisionReason}`,
      user?.id ?? null
    );
    if (deleteBump.error) return { error: deleteBump.error };
  }

  const { data: deletedRows, error: deleteError } = await supabase.from("itp_items").delete().eq("id", itemId).select("id");
  if (deleteError || !deletedRows?.length) {
    await deleteBump?.undo?.();
    return {
      error:
        deleteError?.code === "P0001" || deleteError?.code === "23503"
          ? "This activity is referenced by other records, so it can't be deleted."
          : "Could not delete the activity. Check you have permission and try again.",
    };
  }

  await resetReviewIfUnderReview(supabase, itpId, `activity ${resolved.itemNumber} deleted`, null);

  if (resolved.organizationId) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await recordAuditEvent(supabase, {
        organizationId: resolved.organizationId,
        projectId: resolved.projectId,
        entityType: "itp_item",
        entityId: itemId,
        action: "item_deleted",
        actorId: user?.id ?? null,
        summary: `Activity ${resolved.itemNumber} deleted: ${resolved.activity}`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

async function moveItpItem(formData: FormData, direction: "up" | "down") {
  const itemId = String(formData.get("item_id") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();
  if (!itemId) return;

  const supabase = await createSupabaseServerClient();
  const resolved = await resolveItemItp(supabase, itemId);
  if (!resolved) return;

  const { data: siblings } = await supabase
    .from("itp_items")
    .select("id, sort_order")
    .eq("section_id", resolved.sectionId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<{ id: string; sort_order: number }[]>();
  const ordered = siblings ?? [];
  const index = ordered.findIndex((s) => s.id === itemId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) return;

  if (resolved.status === "superseded" || resolved.status === "withdrawn") return;
  let moveBump: BumpResult | null = null;
  if (resolved.status === "approved" || resolved.status === "client_accepted") {
    if (!revisionReason) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    moveBump = await bumpRevisionIfIssued(
      supabase,
      resolved.itpId,
      `Moved activity ${resolved.itemNumber} ${direction} — ${revisionReason}`,
      user?.id ?? null
    );
    if (moveBump.error) return;
  }

  // Re-number sort_order 0..n so equal/zero values (older manually-added items) can't tie.
  const reordered = [...ordered];
  [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];
  const moveResults = await Promise.all(reordered.map((row, i) => supabase.from("itp_items").update({ sort_order: i }).eq("id", row.id)));
  if (moveResults.some((r) => r.error)) {
    await moveBump?.undo?.();
    return;
  }
  await resetReviewIfUnderReview(supabase, resolved.itpId, `activity ${resolved.itemNumber} moved`, null);

  revalidatePath(`/inspect/itps/${resolved.itpId}`);
}

export async function moveItemUpAction(formData: FormData) {
  await moveItpItem(formData, "up");
}

export async function moveItemDownAction(formData: FormData) {
  await moveItpItem(formData, "down");
}

export interface SetInterventionState {
  error: string | null;
}

export async function setInterventionAction(formData: FormData): Promise<SetInterventionState> {
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const intervention = String(formData.get("intervention") ?? "").trim();
  const revisionReason = String(formData.get("revision_reason") ?? "").trim();
  if (!itpItemId || !projectPartyId) return { error: "Missing activity or party." };

  const supabase = await createSupabaseServerClient();

  // The ITP is resolved from the ACTIVITY (never the posted itp_id, which used to decide whether a
  // revision was needed while the write targeted the item), and the party must belong to the same project.
  const resolvedItem = await resolveItemItp(supabase, itpItemId);
  if (!resolvedItem) return { error: "Activity not found." };
  const itpId = resolvedItem.itpId;
  if (resolvedItem.status === "superseded" || resolvedItem.status === "withdrawn") {
    return { error: `This ITP is ${resolvedItem.status} and can no longer be edited.` };
  }
  const { data: partyRow } = await supabase
    .from("project_parties")
    .select("id")
    .eq("id", projectPartyId)
    .eq("project_id", resolvedItem.projectId)
    .maybeSingle<{ id: string }>();
  if (!partyRow) return { error: "That party isn't on this project." };

  // A signed-off point keeps its level (the database refuses the change too).
  const { data: signedRow } = await supabase
    .from("activity_signoff_progress")
    .select("status")
    .eq("itp_item_id", itpItemId)
    .eq("project_party_id", projectPartyId)
    .maybeSingle<{ status: string }>();
  if (signedRow && (signedRow.status === "signed_off" || signedRow.status === "proceeded_no_response")) {
    return { error: "This point has already been signed off, so its level can't be changed. Raise a new activity or a revision instead." };
  }

  // Changing a sign-off level on an issued ITP is an edit-after-issue like adding/editing an
  // activity: freeze the pre-change content and bump the revision (with the reason) BEFORE applying
  // it. A no-op change (same level as already stored) is not an edit and never bumps.
  const { data: currentLevel } = await supabase
    .from("activity_party_intervention")
    .select("intervention")
    .eq("itp_item_id", itpItemId)
    .eq("project_party_id", projectPartyId)
    .maybeSingle<{ intervention: string }>();
  if ((currentLevel?.intervention ?? "") === intervention) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return { error: null };
  }
  let revisionBump: BumpResult | null = null;
  if (resolvedItem.status === "approved" || resolvedItem.status === "client_accepted") {
    if (!revisionReason) {
      return { error: "This ITP has already been issued — a reason is required to change a sign-off level." };
    }
    const {
      data: { user: revisionUser },
    } = await supabase.auth.getUser();
    revisionBump = await bumpRevisionIfIssued(
      supabase,
      itpId,
      `Sign-off level ${intervention || "cleared"} (was ${currentLevel?.intervention ?? "none"}) — ${revisionReason}`,
      revisionUser?.id ?? null
    );
    if (revisionBump.error) return { error: revisionBump.error };
  }

  if (!intervention) {
    const { error: clearError } = await supabase
      .from("activity_party_intervention")
      .delete()
      .eq("itp_item_id", itpItemId)
      .eq("project_party_id", projectPartyId);
    if (clearError) {
      await revisionBump?.undo?.();
      return { error: "Could not clear the sign-off level. It may already be signed off, or you may not have permission." };
    }

    try {
      const { data: context } = await supabase
        .from("itp_items")
        .select("itp_sections(itps(project_id, projects(organization_id)))")
        .eq("id", itpItemId)
        .maybeSingle<{ itp_sections: { itps: { project_id: string; projects: { organization_id: string } | null } | null } | null }>();
      const itp = context?.itp_sections?.itps;
      const organizationId = itp?.projects?.organization_id;
      if (organizationId) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        await recordAuditEvent(supabase, {
          organizationId,
          projectId: itp?.project_id,
          entityType: "activity_party_intervention",
          entityId: itpItemId,
          action: "cleared",
          actorId: user?.id ?? null,
          summary: "Sign-off intervention cleared for a party on this activity",
        });
      }
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  } else {
    // Look up the label for the notification below (and, incidentally, resolve the organisation so
    // we know which org's levels to check against) before writing the row — the DB itself is the
    // real source of truth for "is this a valid code" (validate_activity_intervention_code trigger,
    // supabase/migrations/20260917090000_configurable_intervention_levels.sql), this is just so the
    // notification reads e.g. "Client QA Review" for a custom level instead of a bare code.
    const { data: context } = await supabase
      .from("itp_items")
      .select("activity, itp_sections(itps(itp_number, project_id, projects(organization_id)))")
      .eq("id", itpItemId)
      .maybeSingle<{
        activity: string;
        itp_sections: {
          itps: {
            itp_number: string;
            project_id: string;
            projects: { organization_id: string } | null;
          } | null;
        } | null;
      }>();

    const itp = context?.itp_sections?.itps;
    const organizationId = itp?.projects?.organization_id;

    let interventionLabel = intervention;
    if (organizationId) {
      const { data: levelType } = await supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("label")
        .eq("organization_id", organizationId)
        .eq("code", intervention)
        .maybeSingle<{ label: string }>();
      if (levelType?.label) interventionLabel = levelType.label;
    }

    const { error: upsertError } = await supabase.from("activity_party_intervention").upsert(
      {
        itp_item_id: itpItemId,
        project_party_id: projectPartyId,
        intervention,
      },
      { onConflict: "itp_item_id,project_party_id" }
    );

    if (upsertError) {
      await revisionBump?.undo?.();
      return { error: "Could not set the sign-off level. The point may already be signed off, or you may not have permission." };
    }

    if (organizationId) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        await recordAuditEvent(supabase, {
          organizationId,
          projectId: itp?.project_id,
          entityType: "activity_party_intervention",
          entityId: itpItemId,
          action: "set",
          actorId: user?.id ?? null,
          summary: `${interventionLabel} set for a party on ${context?.activity ?? "an activity"}`,
          changes: { intervention, project_party_id: projectPartyId },
        });
      } catch {
        // Best-effort — see lib/audit/log.ts's doc comment.
      }
    }

    // Best-effort: the assigned party otherwise has no signal at all that they're now responsible
    // for a sign-off — the only other notification in this flow is notifyPartyAction, which fires
    // solely when someone manually clicks "Notify" on the resulting activity_signoff_progress row.
    // Without this, a party can go unaware of new intervention work indefinitely. Never blocks the
    // intervention assignment itself, which has already succeeded above.
    try {
      const { data: party } = await supabase
        .from("project_parties")
        .select("user_id")
        .eq("id", projectPartyId)
        .maybeSingle<{ user_id: string | null }>();

      if (party?.user_id && itp && organizationId) {
        await createNotification(supabase, {
          organizationId,
          projectId: itp.project_id,
          recipientUserId: party.user_id,
          title: `${interventionLabel} point assigned to you`,
          body: `${context?.activity} (${itp.itp_number})`,
          link: `/inspect/itps/${itpId}`,
        });
      }
    } catch {
      // Notification delivery is best-effort — see comment above.
    }
  }

  await resetReviewIfUnderReview(supabase, itpId, "sign-off level changed", null);
  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

const NEXT_STATUS = {
  draft: "under_review",
  under_review: "approved",
} as const;

export interface AdvanceItpStatusState {
  error: string | null;
  /** Non-blocking warning (the status change succeeded), e.g. checklists could not be generated. */
  notice?: string | null;
}

/**
 * R79: configurable required reviewer/approver. Changed from a plain `(formData) => void` action to
 * the AddItemState-style `(prevState, formData) => State` shape (see AddItemState above) so a
 * restriction failure has somewhere to surface — a silent no-op here would be a worse UX regression
 * than the gap this closes (a staffer clicking "Approve" and nothing happening, with no explanation,
 * is strictly worse than today's unrestricted behaviour). The caller in
 * app/inspect/itps/[id]/page.tsx now uses useActionState instead of a plain `<form action={...}>`.
 */
export async function advanceItpStatusAction(
  _prev: AdvanceItpStatusState,
  formData: FormData
): Promise<AdvanceItpStatusState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const fromStatus = String(formData.get("from_status") ?? "").trim() as keyof typeof NEXT_STATUS;
  const nextStatus = NEXT_STATUS[fromStatus];
  if (!nextStatus) return { error: null };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (nextStatus === "approved") {
    const gate = await checklistReviewError(supabase, itpId, formData);
    if (gate) return { error: gate };

    // Optional stricter default (ITP_REQUIRE_APPROVE_PERMISSION=1): only a JAGS Admin or someone holding the
    // approve_itp permission may approve, instead of any JAGS staff member on the project.
    if (approvePermissionStrict() && !isAdminStaff(session)) {
      const { data: approvalItp } = await supabase.from("itps").select("project_id").eq("id", itpId).maybeSingle<{ project_id: string }>();
      const allowed =
        !!approvalItp &&
        mayApproveItp({
          isAdmin: false,
          isJagsStaff: session.isJagsStaff,
          hasApprovePermission: await hasPermission(session.userId, "approve_itp", approvalItp.project_id),
          strict: true,
        });
      if (!allowed) return { error: "Approving an ITP needs the approve permission (or a JAGS Admin)." };
    }
  }

  // Look up this org's approval-workflow config (if any) before writing the status change — a
  // missing row (the common case: no org has configured this) means "unrestricted", identical to
  // today's behaviour, exactly like intervention levels' three-tier notice-hours fallback pattern
  // elsewhere in this file. An Admin can always override a configured restriction (this app's
  // existing "Admin can do anything a more specific role can" convention — see isAdminStaff's own
  // doc comment).
  if (!isAdminStaff(session)) {
    const { data: itpOrg } = await supabase
      .from("itps")
      .select("projects(organization_id)")
      .eq("id", itpId)
      .maybeSingle<{ projects: { organization_id: string } | null }>();
    const organizationId = itpOrg?.projects?.organization_id;

    if (organizationId) {
      const { data: workflowConfig } = await supabase
        .from(ITP_APPROVAL_WORKFLOW_CONFIGS_TABLE)
        .select("required_reviewer_user_id, required_approver_user_id")
        .eq("organization_id", organizationId)
        .maybeSingle<ItpApprovalWorkflowConfigRow>();

      const requiredUserId =
        nextStatus === "under_review"
          ? workflowConfig?.required_reviewer_user_id
          : workflowConfig?.required_approver_user_id;

      if (requiredUserId && requiredUserId !== session.userId) {
        const { data: requiredUser } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", requiredUserId)
          .maybeSingle<{ full_name: string }>();
        const step = nextStatus === "under_review" ? "submitted for review" : "approved";
        return {
          error: `This ITP can only be ${step} by ${requiredUser?.full_name ?? "a specific reviewer"} (or a JAGS Admin), per this organisation's configured approval workflow.`,
        };
      }
    }
  }

  // R79 extension: once a project has a configured multi-person review chain and this ITP has an
  // in-progress snapshot of it, the single-click Approve button is no longer the real gate —
  // approveReviewStepAction (lib/itps/review-chain.ts) auto-approves the ITP the moment the last
  // reviewer signs off. Blocking the plain button here (even for staff, other than a JAGS Admin's
  // documented override) stops someone from skipping the hierarchy by clicking the button that used
  // to be the only path.
  if (nextStatus === "approved" && !isAdminStaff(session)) {
    const reviewSteps = await getItpReviewProgress(supabase, itpId);
    if (reviewSteps.length > 0 && reviewSteps.some((s) => s.status === "pending")) {
      return {
        error: "This ITP has a configured review chain still in progress — it will approve automatically once every reviewer has signed off, or a JAGS Admin can override.",
      };
    }
  }

  if (nextStatus === "under_review") {
    const { data: sectionRows, error: sectionReadError } = await supabase.from("itp_sections").select("id").eq("itp_id", itpId).returns<{ id: string }[]>();
    const sectionIds = (sectionRows ?? []).map((r) => r.id);
    const { count: activityCount, error: activityReadError } = sectionIds.length
      ? await supabase.from("itp_items").select("id", { count: "exact", head: true }).in("section_id", sectionIds)
      : { count: 0, error: null };
    if (sectionReadError || activityReadError) {
      return { error: "Could not check the ITP's activities right now (the database was busy). Try again." };
    }
    if (!activityCount) {
      return { error: "Add at least one activity before submitting this ITP for review." };
    }
  }

  // No self-approval: the person who submitted the ITP for review can't also approve it. A JAGS Admin
  // may still do both (single-admin teams), but it is recorded as a self-approval in the audit trail.
  let selfApproved = false;
  if (nextStatus === "approved") {
    const { data: submitted } = await supabase
      .from("itps")
      .select("reviewed_by, prepared_by")
      .eq("id", itpId)
      .maybeSingle<{ reviewed_by: string | null; prepared_by: string | null }>();
    const isSubmitter = !!user?.id && (submitted?.reviewed_by === user.id || submitted?.prepared_by === user.id);
    if (isSubmitter) {
      if (!isAdminStaff(session)) {
        return { error: "You prepared or submitted this ITP, so someone else has to approve it (segregation of duties)." };
      }
      selfApproved = true;
    }
  }

  const now = new Date().toISOString();
  const update =
    nextStatus === "under_review"
      ? { status: nextStatus, reviewed_by: user?.id ?? null, reviewed_at: now }
      : { status: nextStatus, approved_by: user?.id ?? null, approved_at: now };

  const { data: advancedRows, error } = await supabase.from("itps").update(update).eq("id", itpId).eq("status", fromStatus).select("id");

  if (error) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return { error: "Could not update the ITP status. Check you have permission and try again." };
  }
  if (!advancedRows?.length) {
    revalidatePath(`/inspect/itps/${itpId}`);
    return { error: "This ITP's status has already changed — refresh the page to see where it is now." };
  }

  let checklistNotice: string | null = null;
  // Best-effort: fetched once and reused by every side-effect below (audit trail, submit-for-review
  // staff notification, initial-issue revision snapshot, client-acceptance notification) — none of
  // these block the status change itself, which has already succeeded (error was already checked above).
  if (!error) {
    try {
      const { data: itp } = await supabase
        .from("itps")
        .select("itp_number, title, project_id, projects(organization_id)")
        .eq("id", itpId)
        .maybeSingle<{
          itp_number: string;
          title: string;
          project_id: string;
          projects: { organization_id: string } | null;
        }>();

      const organizationId = itp?.projects?.organization_id;

      if (organizationId) {
        // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
        // status change above — see lib/audit/log.ts's doc comment.
        await recordAuditEvent(supabase, {
          organizationId,
          projectId: itp.project_id,
          entityType: "itp",
          entityId: itpId,
          action: selfApproved ? "self_approved" : "status_changed",
          actorId: user?.id ?? null,
          summary: `ITP ${itp.itp_number} moved to ${nextStatus}${selfApproved ? " (approved by the same person who prepared/submitted it)" : ""}`,
        });
      }

      // Best-effort: a self-managed client's own party can now submit its own draft ITP for review
      // (itps_client_submit_for_review, 20260921000000_self_managed_submit_and_checklist_gen.sql) —
      // JAGS still has to Approve, so whichever JAGS staff can reach this org need to actually notice
      // the new "under_review" ITP is waiting on them, rather than a client-driven submission going
      // unnoticed until someone happens to check the register. Never fires for a JAGS-staff submission
      // (nothing for staff to notify themselves about).
      if (nextStatus === "under_review" && organizationId) {
        // R79 extension: if this project has a configured review chain, snapshot it onto the ITP
        // right now and let startReviewChainForItp notify only the FIRST reviewer — the broad
        // "notify every JAGS staff member" fallback below is for projects with no chain configured,
        // where any staff member clicking the single Approve button is still the real mechanism.
        const chainStarted = await startReviewChainForItp(supabase, itpId, itp?.project_id ?? "");

        const { data: submitter } = user
          ? await supabase.from("users").select("is_jags_staff").eq("id", user.id).maybeSingle<{ is_jags_staff: boolean }>()
          : { data: null };

        if (!chainStarted && !submitter?.is_jags_staff) {
          const { data: grants } = await supabase
            .from("access_grants")
            .select("user_id")
            .or(`scope_type.eq.global,organization_id.eq.${organizationId},project_id.eq.${itp?.project_id}`)
            .returns<{ user_id: string }[]>();

          const staffUserIds = new Set((grants ?? []).map((g) => g.user_id));
          if (staffUserIds.size > 0) {
            const { data: staffUsers } = await supabase
              .from("users")
              .select("id")
              .in("id", Array.from(staffUserIds))
              .eq("is_jags_staff", true)
              .returns<{ id: string }[]>();

            for (const staffUser of staffUsers ?? []) {
              await createNotification(supabase, {
                organizationId,
                projectId: itp?.project_id ?? null,
                recipientUserId: staffUser.id,
                title: "ITP submitted for review",
                body: `${itp?.itp_number} — ${itp?.title}`,
                link: `/inspect/itps/${itpId}`,
              });
            }
          }
        }
      }

      if (nextStatus === "approved") {
        // R101: revision 0's baseline snapshot is written the moment the document is first
        // genuinely "issued" — this is that moment.
        await snapshotInitialIssue(supabase, itpId, user?.id ?? null);
        await recordChecklistReviewTick(supabase, { itpId, decision: "approve", formData, actorId: user?.id ?? null });
        // Checklists for activities that don't have one yet (e.g. an AI draft by a client/contractor creator,
        // or activities pasted in): idempotent. "starter" mode falls back to a deterministic non-AI starter
        // checklist when AI is off / unpaid / fails, so approval always leaves checklists; a failure is surfaced.
        if (itp && organizationId) {
          try {
            const gen = await generateChecklistsForItp(supabase, { itpId, itpNumber: itp.itp_number, projectId: itp.project_id, organizationId, userId: user?.id ?? null, mode: "starter" });
            if (gen.error) checklistNotice = `ITP approved, but checklists were not generated: ${gen.error} Use "Generate checklists" on the checklists page.`;
          } catch {
            checklistNotice = 'ITP approved, but checklists could not be generated. Use "Generate checklists" on the checklists page.';
          }
        }

        // Once Approved, the client's own acceptance is the next real step in the workflow
        // (accept_itp()) — notify their linked user directly rather than relying on them noticing
        // it on their own dashboard.
        if (itp && organizationId) {
          const { data: clientParty } = await supabase
            .from("project_parties")
            .select("user_id")
            .eq("project_id", itp.project_id)
            .eq("party_type", "client")
            .eq("is_active", true)
            .not("user_id", "is", null)
            .returns<{ user_id: string | null }[]>();

          for (const party of clientParty ?? []) {
            if (!party.user_id) continue;
            await createNotification(supabase, {
              organizationId,
              projectId: itp.project_id,
              recipientUserId: party.user_id,
              title: "ITP ready for your acceptance",
              body: `${itp.itp_number} — ${itp.title}`,
              link: `/inspect/itps/${itpId}`,
            });
          }
        }
      }
    } catch {
      // Best-effort — see comment above.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null, notice: checklistNotice };
}

export interface ApproveRevisionState {
  error: string | null;
}

/**
 * An edit to an issued ITP creates a new revision that has to be approved again before it is the
 * controlled version. The person who made the change can't approve it (a JAGS Admin may, and that is
 * recorded); anyone else with JAGS staff access, or the approve_itp permission, can. Clients are told
 * the revision is approved so they can re-check it.
 */
export async function approveItpRevisionAction(_prev: ApproveRevisionState, formData: FormData): Promise<ApproveRevisionState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  if (!itpId) return { error: "Missing ITP." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select("status, revision, itp_number, title, project_id, revision_needs_approval, revision_changed_by, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{
      status: string;
      revision: number;
      itp_number: string;
      title: string;
      project_id: string;
      revision_needs_approval: boolean;
      revision_changed_by: string | null;
      projects: { organization_id: string } | null;
    }>();
  if (!itp) return { error: "ITP not found." };
  if (!itp.revision_needs_approval) return { error: "This revision doesn't need approval." };

  const mayApprove = mayApproveItp({
    isAdmin: isAdminStaff(session),
    isJagsStaff: session.isJagsStaff,
    hasApprovePermission: await hasPermission(session.userId, "approve_itp", itp.project_id),
    strict: approvePermissionStrict(),
  });
  if (!mayApprove) return { error: "Only JAGS staff, or someone granted the approve permission, can approve a revision." };
  const isChanger = itp.revision_changed_by === session.userId;
  if (isChanger && !isAdminStaff(session)) {
    return { error: "You made this change, so someone else has to approve the new revision (segregation of duties)." };
  }

  const { data: clearedRows, error } = await supabase
    .from("itps")
    .update({ revision_needs_approval: false } as never)
    .eq("id", itpId)
    .select("id");
  if (error || !clearedRows?.length) return { error: "Could not approve the revision. Check you have permission and try again." };

  // Freeze the approved content (the controlled copy for this revision), and, if the client had accepted
  // an earlier revision, send the ITP back to "approved" so the client has to accept THIS revision.
  // Both are best-effort around the approval itself, which has already succeeded.
  let reacceptanceRequired = false;
  try {
    await snapshotApprovedRevision(supabase, itpId, session.userId);
    if (itp.status === "client_accepted") {
      const { data: reset } = await supabase.from("itps").update({ status: "approved" } as never).eq("id", itpId).eq("status", "client_accepted").select("id");
      reacceptanceRequired = !!reset?.length;
    }
  } catch {
    // Best-effort.
  }

  try {
    const organizationId = itp.projects?.organization_id;
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: isChanger ? "revision_self_approved" : "revision_approved",
        actorId: session.userId,
        summary: `${itp.itp_number} revision ${itp.revision} approved${isChanger ? " (by the person who made the change)" : ""}`,
      });
      const { data: clientParties } = await supabase
        .from("project_parties")
        .select("user_id")
        .eq("project_id", itp.project_id)
        .eq("party_type", "client")
        .eq("is_active", true)
        .not("user_id", "is", null)
        .returns<{ user_id: string | null }[]>();
      const { data: acceptorRow } = await supabase
        .from("itps")
        .select("assigned_acceptor_user_id")
        .eq("id", itpId)
        .maybeSingle<{ assigned_acceptor_user_id: string | null }>();
      const recipients = revisionApprovalRecipients({
        approverId: session.userId,
        changedBy: itp.revision_changed_by,
        clientUserIds: (clientParties ?? []).map((p) => p.user_id),
        assignedAcceptorId: reacceptanceRequired ? acceptorRow?.assigned_acceptor_user_id ?? null : null,
      });
      for (const recipient of recipients) {
        const isClient = recipient.role !== "changer";
        await createNotification(supabase, {
          organizationId,
          projectId: itp.project_id,
          recipientUserId: recipient.userId,
          title: isClient
            ? `ITP revision ${itp.revision} approved${reacceptanceRequired ? " — your acceptance is needed again" : ""}`
            : `Your change to ${itp.itp_number} (revision ${itp.revision}) was approved`,
          body: `${itp.itp_number} — ${itp.title}`,
          link: `/inspect/itps/${itpId}`,
        });
      }
    }
  } catch {
    // Best-effort.
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export interface ReturnItpState {
  error: string | null;
}

/**
 * A reviewer sends an ITP back to its preparer with a written reason — the document-control "reject /
 * request changes" step. under_review -> draft; every review step is cleared (the chain starts over on
 * resubmission); the preparer and submitter are notified with the reason. Allowed for a JAGS Admin, the
 * reviewer whose turn it currently is, or any JAGS staff member when no review chain is running.
 */
export async function returnItpToDraftAction(_prev: ReturnItpState, formData: FormData): Promise<ReturnItpState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!itpId) return { error: "Missing ITP." };
  if (reason.length < 5) return { error: "Give a reason for returning the ITP (at least 5 characters)." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: itp, error: itpReadError } = await supabase
    .from("itps")
    .select("status, itp_number, title, prepared_by, reviewed_by, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{
      status: string;
      itp_number: string;
      title: string;
      prepared_by: string | null;
      reviewed_by: string | null;
      project_id: string;
      projects: { organization_id: string } | null;
    }>();
  if (itpReadError) return { error: "Could not read the ITP right now (the database was busy). Try again." };
  if (!itp) return { error: "ITP not found." };
  if (itp.status !== "under_review") return { error: "Only an ITP that is under review can be returned to its preparer." };

  if (!isAdminStaff(session)) {
    const steps = await getItpReviewProgress(supabase, itpId);
    const currentStep = steps.find((s) => s.status === "pending");
    const allowed = steps.length > 0 ? currentStep?.reviewerUserId === session.userId : session.isJagsStaff;
    if (!allowed) return { error: "Only a JAGS Admin, or the reviewer whose turn it is, can return this ITP." };
  }

  const { data: returnedRows, error } = await supabase
    .from("itps")
    .update({
      status: "draft",
      returned_by: session.userId,
      returned_at: new Date().toISOString(),
      returned_reason: reason,
    } as never)
    .eq("id", itpId)
    .eq("status", "under_review")
    .select("id");
  if (error || !returnedRows?.length) return { error: "Could not return the ITP. It may have just changed status — refresh and try again." };

  // Keep the round that was just returned (who had approved what, and when) before clearing the chain.
  await archiveReviewChain(supabase, itpId, reason);
  await supabase.from(ITP_REVIEW_PROGRESS_TABLE).delete().eq("itp_id", itpId);

  try {
    const organizationId = itp.projects?.organization_id;
    if (organizationId) {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "returned_to_draft",
        actorId: session.userId,
        summary: `ITP ${itp.itp_number} returned to the preparer: ${reason}`,
      });
      for (const recipientId of new Set([itp.prepared_by, itp.reviewed_by].filter((v): v is string => !!v && v !== session.userId))) {
        await createNotification(supabase, {
          organizationId,
          projectId: itp.project_id,
          recipientUserId: recipientId,
          title: "ITP returned for changes",
          body: `${itp.itp_number} — ${itp.title}: ${reason}`,
          link: `/inspect/itps/${itpId}`,
        });
      }
    }
  } catch {
    // Best-effort.
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export interface AcceptItpState {
  error: string | null;
}

/**
 * Real bug found live: this used to call the accept_itp RPC and completely ignore any error it
 * raised (no destructuring, no check) — the button just silently did nothing whenever the RPC
 * rejected the call, with zero feedback to the client clicking it. Now returns a real error state
 * (mirroring advanceItpStatusAction's own fix for the same class of problem) so accept_itp's actual
 * exception message — e.g. "Only the client party's own login can accept this ITP" or "ITP must be
 * approved before it can be accepted" — reaches the screen instead of vanishing.
 */
export async function acceptItpAction(_prev: AcceptItpState, formData: FormData): Promise<AcceptItpState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const gate = await checklistReviewError(supabase, itpId, formData);
  if (gate) return { error: gate };

  const { error: rpcError } = await supabase.rpc("accept_itp", { target_itp_id: itpId });
  if (rpcError) {
    return { error: safeDbMessage(rpcError, "Could not accept this ITP. Check you have permission and try again.", "accept_itp") };
  }

  // Best-effort: confirm the RPC actually landed (status is now client_accepted) before recording
  // it, rather than assuming success — the audit trail is a convenience layer on top of the real
  // mutation, never a source of truth of its own. Never blocks the caller either way.
  try {
    const { data: itp } = await supabase
      .from("itps")
      .select("itp_number, status, project_id, projects(organization_id)")
      .eq("id", itpId)
      .maybeSingle<{
        itp_number: string;
        status: string;
        project_id: string;
        projects: { organization_id: string } | null;
      }>();

    if (itp?.status === "client_accepted" && itp.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "accepted",
        actorId: user?.id ?? null,
        summary: `ITP ${itp.itp_number} accepted by client`,
      });
      await recordChecklistReviewTick(supabase, { itpId, decision: "accept", formData, actorId: user?.id ?? null });
      // S2-04: checklists for any activity that still has none (idempotent). The accepted ITP is the
      // point at which the client has signed off the content the checklists are built from.
      try {
        await generateChecklistsForItp(supabase, {
          itpId,
          itpNumber: itp.itp_number,
          projectId: itp.project_id,
          organizationId: itp.projects.organization_id,
          userId: user?.id ?? null,
        });
      } catch {
        // The manual "Generate checklists" button still works.
      }
    }
  } catch {
    // Best-effort — see doc comment above.
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  // The dashboard's "awaiting your acceptance" list shows this ITP too.
  revalidatePath("/inspect");
  return { error: null };
}

export interface AssignItpAcceptorState {
  error: string | null;
}

/**
 * Admin-only: assigns (or clears) the ONE specific client-side login who may accept this ITP,
 * written to itps.assigned_acceptor_user_id. Null (the default, or after clearing) keeps today's
 * behaviour — any login linked to the project's client party can accept, unchanged. The real
 * restriction once an acceptor IS assigned is enforced inside accept_itp() itself (see
 * supabase/migrations/20260930040000_itp_review_chain_override_and_assigned_acceptor.sql) — this
 * action's own checks (candidate must actually be an active client party on this ITP's project) are
 * the same "clear message over a raw DB error" belt-and-braces the rest of this file already uses.
 */
export async function assignItpAcceptorAction(_prev: AssignItpAcceptorState, formData: FormData): Promise<AssignItpAcceptorState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const acceptorUserId = String(formData.get("acceptor_user_id") ?? "").trim();

  if (!itpId) return { error: "Missing ITP." };

  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can assign this ITP's acceptor." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select("project_id, itp_number, status, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ project_id: string; itp_number: string; status: string; projects: { organization_id: string } | null }>();

  if (!itp) return { error: "ITP not found." };
  if (itp.status === "client_accepted") {
    return { error: "This ITP has already been accepted — its acceptor can no longer be changed." };
  }

  let newAcceptorId: string | null = null;
  if (acceptorUserId) {
    const { data: candidate } = await supabase
      .from("project_parties")
      .select("id")
      .eq("project_id", itp.project_id)
      .eq("party_type", "client")
      .eq("user_id", acceptorUserId)
      .eq("is_active", true)
      .maybeSingle<{ id: string }>();

    if (!candidate) {
      return { error: "That person isn't an active client-party login on this ITP's project." };
    }
    newAcceptorId = acceptorUserId;
  }

  const { error } = await supabase.from("itps").update({ assigned_acceptor_user_id: newAcceptorId }).eq("id", itpId);
  if (error) return { error: "Could not update the assigned acceptor. Check you have permission and try again." };

  try {
    if (itp.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: newAcceptorId ? "acceptor_assigned" : "acceptor_cleared",
        actorId: session.userId,
        summary: newAcceptorId
          ? `Assigned acceptor set on ${itp.itp_number}`
          : `Assigned acceptor cleared on ${itp.itp_number} — any linked client party can accept again`,
        changes: { acceptor_user_id: newAcceptorId },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export interface RecordExternalApprovalState {
  error: string | null;
}

/**
 * R80: records that a client approved this ITP in their OWN external system (e.g. a document
 * control platform) rather than by clicking Accept in this app — a reference number/date from that
 * system, so the paper trail still lands somewhere even when the client's real sign-off never
 * touches this UI. Staff-only (mirrors every other staff-gated write in this file, e.g.
 * addItpItemAction relies on RLS + canEditContent; here there's no equivalent non-staff path at all,
 * so the check is explicit) — not editable inline by anyone else, but re-submittable by staff to
 * correct a typo'd reference without a separate edit-lock flow.
 */
export async function recordExternalApprovalAction(
  _prev: RecordExternalApprovalState,
  formData: FormData
): Promise<RecordExternalApprovalState> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can record an external approval reference." };
  }

  const itpId = String(formData.get("itp_id") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();

  if (!itpId || !reference) {
    return { error: "A reference is required." };
  }

  const supabase = await createSupabaseServerClient();

  // R80: "QMP internal approval is completed -> ... -> record the EXTERNAL APPROVAL REFERENCE" —
  // this was previously only enforced by the page not rendering the form before internal approval,
  // which a direct POST to this action could bypass. Re-checked here so the rule holds regardless
  // of caller.
  const { data: itp } = await supabase
    .from("itps")
    .select("status, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ status: string; project_id: string; projects: { organization_id: string } | null }>();
  if (!itp || !["approved", "client_accepted"].includes(itp.status)) {
    return { error: "This ITP must be internally approved before recording an external approval reference." };
  }

  const { error } = await supabase
    .from("itps")
    .update({
      external_approval_reference: reference,
      external_approval_recorded_by: session.userId,
      external_approval_recorded_at: new Date().toISOString(),
    })
    .eq("id", itpId);

  if (error) {
    return { error: "Could not save the external approval reference. Check you have permission and try again." };
  }

  const organizationId = itp.projects?.organization_id;
  if (organizationId) {
    try {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "external_approval_recorded",
        actorId: session.userId,
        summary: `External approval reference recorded: ${reference}`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null };
}

export interface TranslateItpContentState {
  error: string | null;
  translated: string | null;
  targetLanguage: string | null;
  /** True once the translation is saved on the ITP (itps.translations); false if it could not be stored. */
  stored?: boolean;
}

const EMPTY_TRANSLATE_STATE: TranslateItpContentState = { error: null, translated: null, targetLanguage: null };

/**
 * R111 / D12: translates this ITP's own title and scope (whatever it actually has recorded — never any
 * other project's data) into a language from a fixed list, and STORES the result on the ITP
 * (itps.translations, one entry per language, with the revision it was made from) so it is shown
 * on the ITP page afterwards without another AI call. It never touches title/scope themselves — the
 * original stays authoritative. Falls back to display-only if the column is not there yet.
 */
const TRANSLATION_LANGUAGES = ["French", "Arabic", "Spanish", "German", "Portuguese", "Chinese", "Hindi", "Urdu"] as const;

export async function translateItpContentAction(
  _prev: TranslateItpContentState,
  formData: FormData
): Promise<TranslateItpContentState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  const targetLanguage = String(formData.get("target_language") ?? "").trim();

  if (!itpId || !targetLanguage) {
    return { ...EMPTY_TRANSLATE_STATE, error: "Missing ITP or target language." };
  }
  // Only a fixed list of languages is accepted: the value goes into the prompt, so free text is an injection vector.
  if (!TRANSLATION_LANGUAGES.includes(targetLanguage as (typeof TRANSLATION_LANGUAGES)[number])) {
    return { ...EMPTY_TRANSLATE_STATE, error: "That language isn't offered." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: itp } = await supabase
    .from("itps")
    .select("title, scope, revision, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{ title: string; scope: string | null; revision: number; project_id: string; projects: { organization_id: string } | null }>();

  if (!itp || !itp.projects) {
    return { ...EMPTY_TRANSLATE_STATE, error: "ITP not found." };
  }
  const organizationId = itp.projects.organization_id;

  const gate = await assertAiAllowed(supabase, organizationId);
  if (!gate.allowed) return { ...EMPTY_TRANSLATE_STATE, error: gate.reason };

  if (!itp.title.trim() && !itp.scope?.trim()) {
    return { ...EMPTY_TRANSLATE_STATE, error: "This ITP has no title or scope text to translate yet." };
  }

  try {
    // The strongest repeat-input candidate in the app: re-picking the same target language for an
    // ITP's title/scope (which rarely change) is the normal way this feature gets used more than
    // once on the same ITP.
    const translateOne = async (text: string): Promise<string> => {
      const inputHash = hashAiCacheInput({ text, targetLanguage });
      const cached = await findCachedAiResponse<string>(supabase, {
        organizationId,
        feature: "content_translation",
        promptVersion: PROMPT_VERSIONS.content_translation,
        inputHash,
      });
      let usage: GeminiTokenUsage | null = null;
      let out: string;
      if (cached) {
        out = cached;
      } else {
        const captured = await withGeminiUsage(() => geminiProvider.translateText({ text, targetLanguage }));
        out = captured.result;
        usage = captured.usage;
      }
      await logAiUsage(supabase, {
        organizationId,
        projectId: itp.project_id,
        userId: user?.id ?? null,
        feature: "content_translation",
        modelId: getGeminiModel("content_translation"),
        promptVersion: PROMPT_VERSIONS.content_translation,
        sourceRef: { itpId, targetLanguage },
        aiResponse: out,
        inputHash,
        servedFromCache: !!cached,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      });
      return out;
    };
    const title = await translateOne(itp.title);
    const scope = itp.scope?.trim() ? await translateOne(itp.scope) : null;
    const translated = [title, scope].filter(Boolean).join("\n\n");

    // Persist on the ITP (D12). Best effort: the translation is still shown if it cannot be saved.
    let stored = false;
    const { data: existing, error: readError } = await supabase.from("itps").select("translations").eq("id", itpId).maybeSingle<{ translations: unknown }>();
    if (!readError) {
      const merged = mergeItpTranslation(existing?.translations, targetLanguage, {
        title,
        scope,
        translated_at: new Date().toISOString(),
        source_revision: itp.revision,
      });
      const { data: saved, error: saveError } = await supabase.from("itps").update({ translations: merged } as never).eq("id", itpId).select("id");
      stored = !saveError && !!saved?.length;
    }
    if (stored) revalidatePath(`/inspect/itps/${itpId}`);
    return { error: null, translated, targetLanguage, stored };
  } catch (err) {
    return { ...EMPTY_TRANSLATE_STATE, error: aiErrorMessage(err, "Could not translate this ITP's content.") };
  }
}
