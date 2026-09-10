"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage } from "@/lib/ai/log";
import { geminiProvider } from "@/lib/ai/gemini-provider";
import type { ItpDraftResult } from "@/lib/ai/provider";

// Reqs R34-R43: spec-to-ITP draft generation. This is a THIRD way to start an ITP, alongside the
// manual form (new-itp-form.tsx) and the master-template copy (new-itp-from-template-form.tsx) —
// neither of those is touched here. The same non-negotiable rule applies as everywhere else AI
// touches this app: nothing produced by generateItpDraftAction below is ever written to the
// database. It only returns a draft for the user to review and edit; only createItpFromDraftAction,
// called separately once the user explicitly confirms, inserts anything.

export interface GenerateItpDraftState {
  error: string | null;
  draft: ItpDraftResult | null;
  projectParties: { id: string; partyType: string; name: string }[];
}

const EMPTY_DRAFT_STATE: GenerateItpDraftState = { error: null, draft: null, projectParties: [] };

export async function generateItpDraftAction(
  _prev: GenerateItpDraftState,
  formData: FormData
): Promise<GenerateItpDraftState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const specDescription = String(formData.get("spec_description") ?? "").trim();

  if (!projectId || !specDescription) {
    return { ...EMPTY_DRAFT_STATE, error: "Project and a spec/scope description are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();

  if (!project) {
    return { ...EMPTY_DRAFT_STATE, error: "Project not found, or you don't have access to it." };
  }

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) {
    return { ...EMPTY_DRAFT_STATE, error: gate.reason };
  }

  const { data: parties } = await supabase
    .from("project_parties")
    .select("id, party_type, name")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .returns<{ id: string; party_type: string; name: string }[]>();

  const projectParties = (parties ?? []).map((p) => ({ id: p.id, partyType: p.party_type, name: p.name }));

  let draft: ItpDraftResult;
  try {
    draft = await geminiProvider.generateItpDraft({ specDescription, projectParties });
  } catch (err) {
    return {
      ...EMPTY_DRAFT_STATE,
      error: err instanceof Error ? err.message : "Could not generate a draft from that description.",
    };
  }

  await logAiUsage(supabase, { organizationId: project.organization_id, userId: user?.id ?? null, feature: "itp_draft" });

  return { error: null, draft, projectParties };
}

export interface CreateItpFromDraftState {
  error: string | null;
}

/**
 * The confirm step: everything here is exactly the same insert logic as createItpAction/
 * copyMasterTemplateToItpAction, just sourced from a (user-reviewed, possibly edited) AI draft
 * instead of a stored template. Nothing about the draft is trusted implicitly — the JSON is
 * re-validated shape-by-shape before any insert.
 */
export async function createItpFromDraftAction(
  _prev: CreateItpFromDraftState,
  formData: FormData
): Promise<CreateItpFromDraftState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const itpNumber = String(formData.get("itp_number") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const applicableStandard = String(formData.get("applicable_standard") ?? "").trim();
  const draftJson = String(formData.get("draft_json") ?? "");

  if (!projectId || !itpNumber || !title || !draftJson) {
    return { error: "Project, ITP number, title and a generated draft are required." };
  }

  let draft: ItpDraftResult;
  try {
    draft = JSON.parse(draftJson) as ItpDraftResult;
  } catch {
    return { error: "The draft could not be read — please regenerate it." };
  }

  if (!Array.isArray(draft.sections) || draft.sections.length === 0) {
    return { error: "The draft has no sections to create an ITP from." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: itp, error } = await supabase
    .from("itps")
    .insert({
      project_id: projectId,
      itp_number: itpNumber,
      title,
      applicable_standard: applicableStandard || null,
      prepared_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !itp) {
    if (error?.code === "23505") {
      return { error: "An ITP with that number already exists for this project." };
    }
    return { error: "Could not create the ITP. Check you have permission and try again." };
  }

  const { data: newSections, error: sectionsError } = await supabase
    .from("itp_sections")
    .insert(
      draft.sections.map((s, i) => ({
        itp_id: itp.id,
        section_number: s.sectionNumber || i + 1,
        title: s.title || `Section ${i + 1}`,
        sort_order: i,
      }))
    )
    .select("id, section_number");

  if (sectionsError || !newSections) {
    return { error: "ITP created, but its sections could not be added from the draft." };
  }

  const sectionIdByNumber = new Map(newSections.map((s) => [s.section_number, s.id]));
  const itemsBySectionNumber = new Map(draft.sections.map((s, i) => [s.sectionNumber || i + 1, s.items]));

  const itemsToInsert = [...sectionIdByNumber.entries()].flatMap(([sectionNumber, sectionId]) => {
    const items = itemsBySectionNumber.get(sectionNumber) ?? [];
    return items
      .filter((item) => item.itemNumber && item.activity)
      .map((item, i) => ({
        section_id: sectionId,
        item_number: item.itemNumber,
        activity: item.activity,
        acceptance_criteria: item.acceptanceCriteria || null,
        evidence_type: item.evidenceType,
        sort_order: i,
      }));
  });

  if (itemsToInsert.length === 0) {
    return { error: "ITP and sections created, but the draft had no valid activities to add." };
  }

  const { data: newItems, error: itemsError } = await supabase
    .from("itp_items")
    .insert(itemsToInsert)
    .select("id, section_id, item_number");

  if (itemsError || !newItems) {
    return { error: "ITP and sections created, but activities could not be added from the draft." };
  }

  // Suggested interventions are best-effort: an item/section not found in the freshly-inserted
  // rows (e.g. the user deleted it during review) is silently skipped rather than failing the
  // whole create — the ITP itself has already been created successfully at this point.
  const sectionNumberByNewId = new Map(newSections.map((s) => [s.id, s.section_number]));
  const interventionsToInsert = newItems.flatMap((newItem) => {
    const sectionNumber = sectionNumberByNewId.get(newItem.section_id);
    const draftItems = sectionNumber !== undefined ? itemsBySectionNumber.get(sectionNumber) ?? [] : [];
    const draftItem = draftItems.find((di) => di.itemNumber === newItem.item_number);
    if (!draftItem) return [];
    return draftItem.suggestedInterventions
      .filter((si) => si.projectPartyId)
      .map((si) => ({
        itp_item_id: newItem.id,
        project_party_id: si.projectPartyId,
        intervention: si.intervention,
      }));
  });

  if (interventionsToInsert.length > 0) {
    // Not treated as a hard failure — the intervention grid remains editable afterward from the
    // normal ITP detail page regardless.
    await supabase.from("activity_party_intervention").insert(interventionsToInsert);
  }

  redirect(`/inspect/itps/${itp.id}`);
}
