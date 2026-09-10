"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  PUNCH_LIST_ITEMS_TABLE,
  PUNCH_LIST_SOURCES,
  type PunchListSource,
} from "@/lib/punch-list/types";

export interface AddPunchItemState {
  error: string | null;
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(PUNCH_LIST_ITEMS_TABLE).insert({
    project_id: projectId,
    description,
    source: "manual",
    location: location || null,
    responsible_party_id: responsiblePartyId || null,
    due_date: dueDate || null,
  });

  if (error) {
    if (error.code === "23503") {
      return { error: "The responsible party doesn't match a known project party." };
    }
    return { error: "Could not add the punch item. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

export interface ClosePunchItemState {
  error: string | null;
}

/**
 * Closes a punch item. Mirrors the NCR close-out gating pattern (lib/ncrs/actions.ts
 * updateNcrAction): closing evidence is required and is enforced here, in the action, since this
 * is the actual authority boundary — not left to the UI to withhold the button.
 */
export async function closePunchItemAction(
  _prev: ClosePunchItemState,
  formData: FormData
): Promise<ClosePunchItemState> {
  const punchItemId = String(formData.get("punch_item_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const closingEvidence = String(formData.get("closing_evidence") ?? "").trim();

  if (!punchItemId || !projectId) {
    return { error: "Missing punch item." };
  }
  if (!closingEvidence) {
    return { error: "Closing evidence is required before this item can be closed." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .update({
      status: "closed",
      closing_evidence: closingEvidence,
      closed_by: user?.id ?? null,
      closed_at: new Date().toISOString(),
    })
    .eq("id", punchItemId);

  if (error) {
    return { error: "Could not close the punch item. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/projects/${projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null };
}

/**
 * Reusable helper for other features to auto-create a project-wide punch item off one of the
 * defined sources, instead of hand-rolling the insert. Deliberately NOT wired into any completion
 * flow by this module — see the integration-point notes in the final report for exactly where each
 * caller should invoke this:
 *
 *  - checklist completion (apps/web/lib/checklists/actions.ts, when an inspection_record is
 *    completed with a 'no' response on a mandatory checklist_items row): source: 'inspection_failure',
 *    sourceInspectionRecordId.
 *  - standalone assignment finalize (apps/web/lib/standalone/actions.ts, when
 *    conclusion = 'conditional_pass'): source: 'fat_conditional_pass', sourceStandaloneAssignmentId.
 *  - NCR raise (apps/web/lib/ncrs/actions.ts createNcrAction): source: 'ncr', sourceNcrId.
 *
 * Manual walkdown entries go through addPunchItemAction above (source: 'manual'), and don't need
 * this helper — 'walkdown' as a distinct source exists for whenever a dedicated walkdown flow is
 * built; there is no such flow yet, so nothing currently produces it.
 */
export async function createPunchItemFromSource(params: {
  projectId: string;
  description: string;
  source: PunchListSource;
  sourceInspectionRecordId?: string;
  sourceStandaloneAssignmentId?: string;
  sourceNcrId?: string;
  location?: string;
  responsiblePartyId?: string;
  dueDate?: string;
}): Promise<{ error: string | null }> {
  if (!PUNCH_LIST_SOURCES.includes(params.source)) {
    return { error: "Invalid punch list source." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(PUNCH_LIST_ITEMS_TABLE).insert({
    project_id: params.projectId,
    description: params.description,
    source: params.source,
    source_inspection_record_id: params.sourceInspectionRecordId ?? null,
    source_standalone_assignment_id: params.sourceStandaloneAssignmentId ?? null,
    source_ncr_id: params.sourceNcrId ?? null,
    location: params.location ?? null,
    responsible_party_id: params.responsiblePartyId ?? null,
    due_date: params.dueDate ?? null,
  });

  if (error) {
    return { error: "Could not create the punch item." };
  }

  revalidatePath(`/inspect/projects/${params.projectId}/punch-list`);
  revalidatePath(`/inspect/projects/${params.projectId}/data-book`);
  return { error: null };
}
