"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { canExecuteItpItem, findProjectIdForItpItem } from "@/lib/checklists/execution-parties";
import { recordAuditEvent } from "@/lib/audit/log";
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import { createNotification } from "@/lib/notifications/helpers";
import { ITP_ITEM_MEASUREMENTS_TABLE, ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE } from "@/lib/itps/evidence-types";

export type MeasurementResult = "pass" | "fail";

export interface ItpItemMeasurementRow {
  id: string;
  itp_item_id: string;
  description: string;
  nominal_value: string | null;
  tolerance: string | null;
  actual_value: string | null;
  unit: string | null;
  result: MeasurementResult | null;
  sort_order: number;
  recorded_by: string | null;
  created_at: string;
}

export interface ItpItemEvidenceDocumentRow {
  id: string;
  itp_item_id: string;
  vault_document_id: string;
  linked_by: string | null;
  created_at: string;
}

async function findItpIdForItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itp_id)")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itp_id: string } | null }>();
  return data?.itp_sections?.itp_id ?? null;
}

/** organizationId + projectId for an itp_items row, for the audit calls below — findProjectIdForItpItem
 *  only returns the project id, not the org, so this is its own small query rather than two round trips. */
async function findOrgAndProjectForItpItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<{ organizationId: string; projectId: string } | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itps(project_id, projects(organization_id)))")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itps: { project_id: string; projects: { organization_id: string } | null } | null } | null }>();
  const itp = data?.itp_sections?.itps;
  const organizationId = itp?.projects?.organization_id;
  if (!organizationId || !itp?.project_id) return null;
  return { organizationId, projectId: itp.project_id };
}

/**
 * R92-96 parity for evidence_type=3: a failed checklist inspection auto-creates a punch item and
 * notifies the activity's stakeholders (lib/checklists/actions.ts completeInspectionCore); a failed
 * measurement row never did, with no reason for the difference — found in a self-review audit. Same
 * "notify every party with a stake in this item, deduped against the ITP's preparer" pattern that
 * function already uses. Called once per measurement row that newly becomes 'fail' — evidence_type=3
 * has no single "complete" action to hang an aggregate per-activity check off, unlike a checklist, so
 * this fires per failing row rather than once per activity.
 */
async function notifyAndPunchOnMeasurementFail(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string,
  measurementDescription: string
): Promise<void> {
  const { data: context } = await supabase
    .from("itp_items")
    .select("activity, item_number, itp_sections(itps(prepared_by, project_id, projects(organization_id)))")
    .eq("id", itpItemId)
    .maybeSingle<{
      activity: string;
      item_number: string;
      itp_sections: {
        itps: { prepared_by: string | null; project_id: string; projects: { organization_id: string } | null } | null;
      } | null;
    }>();

  const itp = context?.itp_sections?.itps;
  const organizationId = itp?.projects?.organization_id;
  const projectId = itp?.project_id;
  if (!organizationId || !projectId || !context) return;

  await createPunchItemFromSource({
    projectId,
    description: `Failed measurement: ${measurementDescription} — ${context.activity} (${context.item_number})`,
    source: "itp_measurement_failure",
    sourceItpItemId: itpItemId,
  });

  try {
    const recipientIds = new Set<string>();
    if (itp?.prepared_by) recipientIds.add(itp.prepared_by);

    const { data: stakeholderParties } = await supabase
      .from("activity_party_intervention")
      .select("project_parties(user_id)")
      .eq("itp_item_id", itpItemId)
      .returns<{ project_parties: { user_id: string | null } | null }[]>();
    for (const row of stakeholderParties ?? []) {
      if (row.project_parties?.user_id) recipientIds.add(row.project_parties.user_id);
    }

    const itpId = await findItpIdForItem(supabase, itpItemId);
    await Promise.all(
      [...recipientIds].map((recipientUserId) =>
        createNotification(supabase, {
          organizationId,
          projectId,
          recipientUserId,
          title: "Measurement failed",
          body: `${context.activity} (${context.item_number}) — ${measurementDescription}`,
          link: `/inspect/itps/${itpId}`,
        })
      )
    );
  } catch {
    // Notification delivery is best-effort — see completeInspectionCore's own comment for why.
  }
}

export interface EvidenceActionState {
  error: string | null;
}

/**
 * Records one measurement/test-parameter row against an evidence_type=3 ("Measurement record")
 * ITP item — the field-execution mechanism that item type never had (see status/page.tsx's own
 * "No execution flow yet" comment). Same flat shape as standalone_assignment_measurements
 * (description/nominal/tolerance/actual/unit/result), reused deliberately rather than inventing a
 * second pattern for the same kind of data — see this migration's own header comment
 * (20260929040000_itp_item_evidence_execution.sql).
 *
 * Gated by canExecuteItpItem — the same "which party may execute this activity" rule checklist-type
 * items already use, generalized in lib/checklists/execution-parties.ts specifically so this file
 * could reuse it rather than re-deriving it.
 */
export async function addItpItemMeasurementAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const nominalValue = String(formData.get("nominal_value") ?? "").trim();
  const tolerance = String(formData.get("tolerance") ?? "").trim();
  const actualValue = String(formData.get("actual_value") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const resultRaw = String(formData.get("result") ?? "").trim();
  const result: MeasurementResult | null = resultRaw === "pass" || resultRaw === "fail" ? resultRaw : null;

  if (!itpItemId || !description) return { error: "A description is required." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!(await canExecuteItpItem(supabase, itpItemId))) {
    return { error: "Only the party assigned to execute this activity (or JAGS staff) can record a measurement." };
  }

  const { count } = await supabase
    .from(ITP_ITEM_MEASUREMENTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("itp_item_id", itpItemId);

  const { error } = await supabase.from(ITP_ITEM_MEASUREMENTS_TABLE).insert({
    itp_item_id: itpItemId,
    description,
    nominal_value: nominalValue || null,
    tolerance: tolerance || null,
    actual_value: actualValue || null,
    unit: unit || null,
    result,
    sort_order: count ?? 0,
    recorded_by: session.userId,
  });

  if (error) return { error: "Could not record the measurement. Check you have permission and try again." };

  // R92-96 parity: a measurement entered as an immediate fail feeds the punch list the same way a
  // failed checklist inspection does. Never blocks the save above, which already succeeded.
  if (result === "fail") {
    await notifyAndPunchOnMeasurementFail(supabase, itpItemId, description);
  }

  try {
    const context = await findOrgAndProjectForItpItem(supabase, itpItemId);
    if (context) {
      await recordAuditEvent(supabase, {
        organizationId: context.organizationId,
        projectId: context.projectId,
        entityType: "itp_item_measurement",
        entityId: itpItemId,
        action: "recorded",
        actorId: session.userId,
        summary: `Measurement recorded: ${description}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
  return { error: null };
}

/**
 * Corrects a measurement row in place — the gap a self-review audit found: previously the only way
 * to fix a mis-entered value, or give a "no result yet" row its actual pass/fail, was delete and
 * re-add, which loses the original recorded_by/created_at. Same ownership rule as delete (below):
 * staff can always edit any row; a non-staff caller must additionally be the row's own recorder.
 * Needs supabase/migrations/20260930010000_itp_item_measurement_update_and_inspection_race_fix.sql
 * applied first — itp_item_measurements had no UPDATE RLS policy until that migration.
 */
export async function updateItpItemMeasurementAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const measurementId = String(formData.get("measurement_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const nominalValue = String(formData.get("nominal_value") ?? "").trim();
  const tolerance = String(formData.get("tolerance") ?? "").trim();
  const actualValue = String(formData.get("actual_value") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const resultRaw = String(formData.get("result") ?? "").trim();
  const result: MeasurementResult | null = resultRaw === "pass" || resultRaw === "fail" ? resultRaw : null;

  if (!measurementId || !itpItemId || !description) return { error: "A description is required." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Fetched up front regardless of staff/non-staff: non-staff needs recorded_by for the ownership
  // check below, and everyone needs the prior result to tell "still fail, already punched" apart
  // from "just turned fail, needs a new punch item" a few lines down.
  const { data: existing } = await supabase
    .from(ITP_ITEM_MEASUREMENTS_TABLE)
    .select("recorded_by, result")
    .eq("id", measurementId)
    .maybeSingle<{ recorded_by: string | null; result: MeasurementResult | null }>();

  if (!session.isJagsStaff) {
    if (!(await canExecuteItpItem(supabase, itpItemId))) {
      return { error: "Only the party assigned to execute this activity (or JAGS staff) can edit a measurement." };
    }
    if (existing?.recorded_by !== session.userId) {
      return { error: "Only the person who recorded this measurement (or JAGS staff) can edit it." };
    }
  }

  const { error } = await supabase
    .from(ITP_ITEM_MEASUREMENTS_TABLE)
    .update({
      description,
      nominal_value: nominalValue || null,
      tolerance: tolerance || null,
      actual_value: actualValue || null,
      unit: unit || null,
      result,
    })
    .eq("id", measurementId);

  if (error) return { error: "Could not update the measurement. Check you have permission and try again." };

  // Only when this edit is what actually MADE it a fail — re-saving an already-failing row (e.g.
  // fixing a typo in the description) must not create a second punch item for the same failure.
  if (result === "fail" && existing?.result !== "fail") {
    await notifyAndPunchOnMeasurementFail(supabase, itpItemId, description);
  }

  try {
    const context = await findOrgAndProjectForItpItem(supabase, itpItemId);
    if (context) {
      await recordAuditEvent(supabase, {
        organizationId: context.organizationId,
        projectId: context.projectId,
        entityType: "itp_item_measurement",
        entityId: measurementId,
        action: "updated",
        actorId: session.userId,
        summary: `Measurement edited: ${description}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
  return { error: null };
}

/**
 * Corrects a mis-entered measurement — staff can always remove any row, mirroring every other
 * delete gate in this app. A non-staff caller must additionally be the row's own recorder, not just
 * any active executing-type party on the activity: found in a self-review audit that
 * canExecuteItpItem alone checks "type + activity membership," not row ownership, so on an activity
 * with two executing parties (e.g. two subcontractors both linked via activity_party_intervention),
 * either could otherwise delete evidence the other one recorded.
 */
export async function deleteItpItemMeasurementAction(formData: FormData): Promise<void> {
  const measurementId = String(formData.get("measurement_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  if (!measurementId || !itpItemId) return;

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  let descriptionForAudit = "Measurement";
  if (!session.isJagsStaff) {
    if (!(await canExecuteItpItem(supabase, itpItemId))) return;
    const { data: row } = await supabase
      .from(ITP_ITEM_MEASUREMENTS_TABLE)
      .select("recorded_by, description")
      .eq("id", measurementId)
      .maybeSingle<{ recorded_by: string | null; description: string }>();
    if (row?.recorded_by !== session.userId) return;
    descriptionForAudit = row.description;
  } else {
    const { data: row } = await supabase
      .from(ITP_ITEM_MEASUREMENTS_TABLE)
      .select("description")
      .eq("id", measurementId)
      .maybeSingle<{ description: string }>();
    if (row) descriptionForAudit = row.description;
  }

  await supabase.from(ITP_ITEM_MEASUREMENTS_TABLE).delete().eq("id", measurementId);

  try {
    const context = await findOrgAndProjectForItpItem(supabase, itpItemId);
    if (context) {
      await recordAuditEvent(supabase, {
        organizationId: context.organizationId,
        projectId: context.projectId,
        entityType: "itp_item_measurement",
        entityId: measurementId,
        action: "deleted",
        actorId: session.userId,
        summary: `Measurement deleted: ${descriptionForAudit}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
}

/**
 * Links an existing vault document as this evidence_type=2 ("Document upload") item's own
 * completion evidence — the field-execution mechanism that item type never had. Deliberately reuses
 * the project's existing Vault (upload there first, same as the governing-drawing picker on
 * AddItemForm already does) rather than building a second upload UI/storage path here: a many-to-
 * many link table (itp_item_evidence_documents), not a new upload mechanism.
 *
 * Found missing in a self-review audit: the client-side picker (page.tsx) already scopes options to
 * this ITP's own project, but nothing re-checked that server-side, and the RLS insert policy on
 * itp_item_evidence_documents never joins vault_documents at all — so a crafted direct form-action
 * call (bypassing the picker entirely) could link a document from a different project a caller
 * happens to also have access to. Same audit found unapproved/superseded documents were linkable
 * too, satisfying this activity's completion requirement with no real evidence review behind it.
 * Both are now checked here, server-side, not just filtered out of the picker's option list.
 */
export async function linkItpItemEvidenceDocumentAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const vaultDocumentIds = [...new Set(formData.getAll("vault_document_id").map((v) => String(v).trim()).filter(Boolean))];
  if (!itpItemId || vaultDocumentIds.length === 0) return { error: "Select at least one file to link." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!(await canExecuteItpItem(supabase, itpItemId))) {
    return { error: "Only the party assigned to execute this activity (or JAGS staff) can link evidence." };
  }

  const itemProjectId = await findProjectIdForItpItem(supabase, itpItemId);
  const { data: vaultDocs } = await supabase
    .from("vault_documents")
    .select("id, status, vault_folders(project_id)")
    .in("id", vaultDocumentIds)
    .returns<{ id: string; status: string; vault_folders: { project_id: string } | null }[]>();

  if (!itemProjectId || (vaultDocs ?? []).length !== vaultDocumentIds.length || (vaultDocs ?? []).some((d) => d.vault_folders?.project_id !== itemProjectId)) {
    return { error: "One of the selected files isn't in this activity's own project." };
  }
  if ((vaultDocs ?? []).some((d) => d.status !== "approved")) {
    return { error: "Only approved files can be linked as evidence — get the others approved in the Document Vault first." };
  }

  const { error } = await supabase
    .from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE)
    .upsert(
      vaultDocumentIds.map((id) => ({ itp_item_id: itpItemId, vault_document_id: id, linked_by: session.userId })),
      { onConflict: "itp_item_id,vault_document_id", ignoreDuplicates: true }
    );

  if (error) return { error: "Could not link the selected files." };

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    const projectId = await findProjectIdForItpItem(supabase, itpItemId);
    try {
      const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId ?? "").maybeSingle<{ organization_id: string }>();
      if (project) {
        await recordAuditEvent(supabase, {
          organizationId: project.organization_id,
          projectId: projectId ?? undefined,
          entityType: "itp_item_evidence_document",
          entityId: itpItemId,
          action: "linked",
          actorId: session.userId,
          summary: "Evidence document linked to activity",
          changes: { vault_document_ids: vaultDocumentIds },
        });
      }
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
  return { error: null };
}

/**
 * Removes the link (never deletes the underlying vault document itself — it may still be
 * referenced elsewhere, e.g. as another activity's governing drawing). Same ownership check as
 * deleteItpItemMeasurementAction above, for the same reason: canExecuteItpItem alone doesn't tell
 * one executing party's link apart from another's on a shared activity.
 */
export async function unlinkItpItemEvidenceDocumentAction(formData: FormData): Promise<void> {
  const linkId = String(formData.get("link_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  if (!linkId || !itpItemId) return;

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!session.isJagsStaff) {
    if (!(await canExecuteItpItem(supabase, itpItemId))) return;
    const { data: row } = await supabase
      .from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE)
      .select("linked_by")
      .eq("id", linkId)
      .maybeSingle<{ linked_by: string | null }>();
    if (row?.linked_by !== session.userId) return;
  }

  await supabase.from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE).delete().eq("id", linkId);

  // Symmetry with linkItpItemEvidenceDocumentAction, which already audits the link — removing
  // evidence right before an activity is marked complete is just as much a "who did this" event as
  // adding it.
  try {
    const context = await findOrgAndProjectForItpItem(supabase, itpItemId);
    if (context) {
      await recordAuditEvent(supabase, {
        organizationId: context.organizationId,
        projectId: context.projectId,
        entityType: "itp_item_evidence_document",
        entityId: itpItemId,
        action: "unlinked",
        actorId: session.userId,
        summary: "Evidence document unlinked from activity",
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
}
