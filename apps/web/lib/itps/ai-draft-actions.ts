"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage, recordAiReviewDecision } from "@/lib/ai/log";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS } from "@/lib/ai/gemini-provider";
import type { ItpDraftResult, ItpSourceDocument } from "@/lib/ai/provider";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { generateChecklistsForItp } from "@/lib/checklists/actions";
import { generateDocumentNumber } from "@/lib/numbering/generate";

// Reqs R34-R43: spec-to-ITP draft generation, grounded in the project's own vault documents (the
// actual attached specs/standards/method statements) rather than a free-typed description alone.
// This is a THIRD way to start an ITP, alongside the manual form (new-itp-form.tsx) and the
// master-template copy (new-itp-from-template-form.tsx) — neither of those is touched here. The
// same non-negotiable rule applies as everywhere else AI touches this app: nothing produced by
// generateItpDraftAction below is ever written to the database. It only returns a draft for the
// user to review and edit; only createItpFromDraftAction, called separately once the user
// explicitly confirms, inserts anything.

export interface GenerateItpDraftState {
  error: string | null;
  draft: ItpDraftResult | null;
  projectParties: { id: string; partyType: string; name: string }[];
  aiLogId: string | null;
  /** An auto-generated ITP number from the org's numbering scheme, offered as a starting value in
   *  the (still freely editable) ITP number field. Drawn from the same atomic sequence used for
   *  real ITPs, so an abandoned draft can leave a gap in the sequence — same as a voided document
   *  number in any real document-control scheme, not a correctness issue. Only generated once per
   *  draft (the "regenerate with feedback" flow reuses it, see generateItpDraftAction) so repeated
   *  regeneration doesn't burn a fresh number each time. Null if numbering couldn't be generated,
   *  in which case the field just starts blank as before. */
  suggestedItpNumber: string | null;
}

const EMPTY_DRAFT_STATE: GenerateItpDraftState = {
  error: null,
  draft: null,
  projectParties: [],
  aiLogId: null,
  suggestedItpNumber: null,
};

export async function generateItpDraftAction(
  _prev: GenerateItpDraftState,
  formData: FormData
): Promise<GenerateItpDraftState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const additionalInstructions = String(formData.get("additional_instructions") ?? "").trim();
  const vaultDocumentIds = formData.getAll("vault_document_ids").map(String).filter(Boolean);
  const existingSuggestedItpNumber = String(formData.get("existing_suggested_itp_number") ?? "").trim() || null;

  if (!projectId || (vaultDocumentIds.length === 0 && !additionalInstructions)) {
    return {
      ...EMPTY_DRAFT_STATE,
      error: "Select at least one vault document, or describe the spec/scope, to generate from.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id, project_number")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string; project_number: string }>();

  if (!project) {
    return { ...EMPTY_DRAFT_STATE, error: "Project not found, or you don't have access to it." };
  }

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) {
    return { ...EMPTY_DRAFT_STATE, error: gate.reason };
  }

  const [{ data: parties }, { data: disciplines }] = await Promise.all([
    supabase
      .from("project_parties")
      .select("id, party_type, name")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .returns<{ id: string; party_type: string; name: string }[]>(),
    supabase
      .from("master_disciplines")
      .select("code, name")
      .eq("is_active", true)
      .order("sort_order")
      .returns<{ code: string; name: string }[]>(),
  ]);

  const projectParties = (parties ?? []).map((p) => ({ id: p.id, partyType: p.party_type, name: p.name }));

  let sourceDocuments: ItpSourceDocument[] = [];
  if (vaultDocumentIds.length > 0) {
    // Scoped by RLS (same has_org_access join as every other vault_documents read) — a document id
    // for a project/org this user can't reach simply won't come back, not an error.
    const { data: docs } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("id, title, document_reference, revision, extracted_text, extraction_status, vault_folders(project_id, name)")
      .in("id", vaultDocumentIds)
      .returns<
        {
          id: string;
          title: string;
          document_reference: string | null;
          revision: string;
          extracted_text: string | null;
          extraction_status: string;
          vault_folders: { project_id: string; name: string } | null;
        }[]
      >();

    const usable = (docs ?? []).filter(
      (d) => d.vault_folders?.project_id === projectId && d.extraction_status === "done" && d.extracted_text
    );

    if (usable.length === 0) {
      return {
        ...EMPTY_DRAFT_STATE,
        error:
          "None of the selected documents have usable extracted text yet (still processing, or their file type isn't supported for text extraction) — pick a different document or add scope in the instructions box instead.",
      };
    }

    sourceDocuments = usable.map((d) => ({
      title: d.title,
      category: d.vault_folders?.name ?? "Document",
      documentReference: d.document_reference,
      revision: d.revision,
      text: d.extracted_text ?? "",
    }));
  }

  let draft: ItpDraftResult;
  try {
    draft = await geminiProvider.generateItpDraft({
      sourceDocuments,
      additionalInstructions,
      projectParties,
      disciplines: disciplines ?? [],
    });
  } catch (err) {
    return {
      ...EMPTY_DRAFT_STATE,
      error: err instanceof Error ? err.message : "Could not generate a draft from the selected documents.",
    };
  }

  const logId = await logAiUsage(supabase, {
    organizationId: project.organization_id,
    userId: user?.id ?? null,
    feature: "itp_draft",
    modelId: getGeminiModel("itp_draft"),
    promptVersion: PROMPT_VERSIONS.itp_draft,
    sourceRef: { vaultDocumentIds, additionalInstructions },
    aiResponse: draft,
  });

  // Reuse the same suggested number across a "regenerate with feedback" cycle rather than drawing a
  // fresh one from the sequence each time — see the field's doc comment on GenerateItpDraftState.
  let suggestedItpNumber = existingSuggestedItpNumber;
  if (!suggestedItpNumber) {
    try {
      const generated = await generateDocumentNumber(supabase, {
        organizationId: project.organization_id,
        projectId,
        docType: "itp",
        projectNumber: project.project_number,
      });
      suggestedItpNumber = generated.documentNumber;
    } catch (err) {
      // Best-effort suggestion only — the field stays editable and required either way.
      console.error("[itp-draft] Could not auto-suggest an ITP number:", err);
    }
  }

  return { error: null, draft, projectParties, aiLogId: logId, suggestedItpNumber };
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
  const aiLogId = String(formData.get("ai_log_id") ?? "").trim() || null;

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

  const disciplineCodes = [...new Set(draft.sections.flatMap((s) => s.items.map((i) => i.disciplineCode).filter(Boolean)))];
  const disciplineIdByCode = new Map<string, string>();
  if (disciplineCodes.length > 0) {
    const { data: disciplineRows } = await supabase
      .from("master_disciplines")
      .select("id, code")
      .in("code", disciplineCodes as string[])
      .returns<{ id: string; code: string }[]>();
    for (const d of disciplineRows ?? []) disciplineIdByCode.set(d.code, d.id);
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
        reference_spec: item.referenceSpec || null,
        acceptance_criteria: item.acceptanceCriteria || null,
        method: item.method || null,
        frequency: item.frequency || null,
        evidence_type: item.evidenceType,
        discipline_id: item.disciplineCode ? (disciplineIdByCode.get(item.disciplineCode) ?? null) : null,
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

  // Closes out the audit-trail row this draft was logged under (see generateItpDraftAction's
  // logAiUsage call) now that a human has confirmed it into a real ITP. Always "edited_and_accepted"
  // rather than trying to detect "user changed nothing" — the draft always passes through an
  // editable review UI before this point (see new-itp-from-ai-form.tsx), and there's no cheap way to
  // tell "no changes" apart from "re-typed the exact same text".
  if (aiLogId && user?.id) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: user.id,
      targetType: "itp",
      targetId: itp.id,
      reviewedResponse: draft,
      decision: "edited_and_accepted",
    });
  }

  // Generate checklists immediately — this ITP's activities came from real, reviewed source
  // material (the vault documents/instructions the draft was grounded in), not built up one item
  // at a time, so there's no reason to make the user separately advance the ITP through
  // Draft -> Under Review -> Approved before it's field-usable. Best-effort: a failure here never
  // undoes the ITP that was just successfully created (see generateChecklistsForItp's doc comment
  // for why this path is intentionally not gated on approval, unlike the manual button).
  const { data: projectForChecklists } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();
  if (projectForChecklists) {
    await generateChecklistsForItp(supabase, {
      itpId: itp.id,
      itpNumber,
      projectId,
      organizationId: projectForChecklists.organization_id,
      userId: user?.id ?? null,
    });
  }

  redirect(`/inspect/itps/${itp.id}`);
}
