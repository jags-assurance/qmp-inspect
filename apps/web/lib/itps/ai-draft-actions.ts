"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertAiAllowed } from "@/lib/ai/gate";
import { aiErrorMessage } from "@/lib/ai/config";
import { sanitizeAiLine, sanitizeAiText } from "@/lib/ai/sanitize";
import { logAiUsage, recordAiReviewDecision } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import type { ItpDraftResult, ItpSourceDocument } from "@/lib/ai/provider";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { generateChecklistsForItp } from "@/lib/checklists/actions";
import { generateDocumentNumber } from "@/lib/numbering/generate";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { recordAuditEvent } from "@/lib/audit/log";

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
  /** This organisation's sign-off levels (Hold/Witness/Review/Surveillance plus any custom ones), so every suggested level can be changed in the draft before the ITP is created. */
  interventionLevels: { code: string; label: string }[];
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
  interventionLevels: [],
  aiLogId: null,
  suggestedItpNumber: null,
};

export async function generateItpDraftAction(
  _prev: GenerateItpDraftState,
  formData: FormData
): Promise<GenerateItpDraftState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const additionalInstructions = String(formData.get("additional_instructions") ?? "").trim().slice(0, 4000);
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

  const [{ data: parties }, disciplines] = await Promise.all([
    supabase
      .from("project_parties")
      .select("id, party_type, name")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .returns<{ id: string; party_type: string; name: string }[]>(),
    getActiveMasterDisciplines(),
  ]);

  const projectParties = (parties ?? []).map((p) => ({ id: p.id, partyType: p.party_type, name: p.name }));
  const { data: levelRows } = await supabase
    .from("intervention_level_types")
    .select("code, label, sort_order")
    .eq("organization_id", project.organization_id)
    .order("sort_order", { ascending: true })
    .returns<{ code: string; label: string; sort_order: number }[]>();
  const interventionLevels = (levelRows ?? []).map((l) => ({ code: l.code, label: l.label }));

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

  // Cost/latency: the heavy-tier model is the single most expensive call in this app, and
  // "regenerate" on the exact same selected documents + instructions is a real, observed pattern
  // (a user re-clicking Generate after just looking at the form again). Cache key mirrors exactly
  // what generateItpDraft is grounded in — see lib/ai/cache.ts.
  const inputHash = hashAiCacheInput({
    model: getGeminiModel("itp_draft"),
    sourceDocuments,
    additionalInstructions,
    projectParties,
    disciplines: disciplines ?? [],
  });
  let draft: ItpDraftResult;
  let servedFromCache = false;
  let usage: GeminiTokenUsage | null = null;
  const cached = await findCachedAiResponse<ItpDraftResult>(supabase, {
    organizationId: project.organization_id,
    feature: "itp_draft",
    promptVersion: PROMPT_VERSIONS.itp_draft,
    inputHash,
  });
  if (cached) {
    draft = cached;
    servedFromCache = true;
  } else {
    try {
      const captured = await withGeminiUsage(() =>
        geminiProvider.generateItpDraft({
          sourceDocuments,
          additionalInstructions,
          projectParties,
          disciplines: disciplines ?? [],
        })
      );
      draft = captured.result;
      usage = captured.usage;
    } catch (err) {
      return {
        ...EMPTY_DRAFT_STATE,
        error: aiErrorMessage(err, "Could not generate a draft from the selected documents."),
      };
    }
  }

  const logId = await logAiUsage(supabase, {
    organizationId: project.organization_id,
    projectId,
    userId: user?.id ?? null,
    feature: "itp_draft",
    modelId: getGeminiModel("itp_draft"),
    promptVersion: PROMPT_VERSIONS.itp_draft,
    sourceRef: { vaultDocumentIds, additionalInstructions },
    aiResponse: draft,
    inputHash,
    servedFromCache,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
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

  return { error: null, draft, projectParties, interventionLevels, aiLogId: logId, suggestedItpNumber };
}

/**
 * The draft arrives back from the browser as hidden-field JSON, so it is untrusted even though it
 * started life as server-validated AI output: rebuild every field with a strict shape, length cap
 * and enum check before anything is inserted.
 */
function normaliseSubmittedDraft(raw: unknown): ItpDraftResult {
  const r = (raw ?? {}) as Partial<ItpDraftResult>;
  const sections = Array.isArray(r.sections) ? r.sections.slice(0, 20) : [];
  return {
    suggestedTitle: null,
    suggestedApplicableStandard: null,
    sections: sections.map((s, si) => ({
      sectionNumber: si + 1,
      title: sanitizeAiLine(s?.title, 200),
      items: (Array.isArray(s?.items) ? s.items.slice(0, 100) : []).map((i) => ({
        itemNumber: sanitizeAiLine(i?.itemNumber, 30),
        activity: sanitizeAiText(i?.activity, 600),
        referenceSpec: sanitizeAiLine(i?.referenceSpec, 300),
        acceptanceCriteria: sanitizeAiText(i?.acceptanceCriteria, 1200),
        method: sanitizeAiText(i?.method, 400),
        frequency: sanitizeAiLine(i?.frequency, 200),
        evidenceType: ([1, 2, 3] as const).includes(Number(i?.evidenceType) as 1 | 2 | 3)
          ? (Number(i.evidenceType) as 1 | 2 | 3)
          : (1 as const),
        disciplineCode: typeof i?.disciplineCode === "string" ? sanitizeAiLine(i.disciplineCode, 20) || null : null,
        suggestedInterventions: (Array.isArray(i?.suggestedInterventions) ? i.suggestedInterventions.slice(0, 50) : [])
          .filter((si2) => si2 && typeof si2.projectPartyId === "string" && typeof si2.intervention === "string")
          .map((si2) => ({
            projectPartyId: si2.projectPartyId,
            // Validated against this organisation's real level codes before insert (below).
            intervention: sanitizeAiLine(si2.intervention, 10) as "H" | "W" | "R" | "S",
            reason: sanitizeAiLine(si2.reason, 300),
          })),
      })),
    })),
  };
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
  if (draftJson.length > 2_000_000) {
    return { error: "The draft is too large to create an ITP from — please regenerate it with a narrower scope." };
  }

  let draft: ItpDraftResult;
  try {
    draft = normaliseSubmittedDraft(JSON.parse(draftJson));
  } catch {
    return { error: "The draft could not be read — please regenerate it." };
  }

  if (draft.sections.length === 0) {
    return { error: "The draft has no sections to create an ITP from." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let numberToUse = itpNumber;
  let { data: itp, error } = await supabase
    .from("itps")
    .insert({
      project_id: projectId,
      itp_number: numberToUse,
      title,
      applicable_standard: applicableStandard || null,
      prepared_by: user?.id ?? null,
    })
    .select("id")
    .single();

  // The suggested number offered on the draft screen can go stale by the time this confirm step
  // runs — a manual/template-created ITP elsewhere can claim it first (numbering.md: only this
  // and createItpAction's free-text path share the same document_sequences counter, and neither
  // reserves a number until insert time). Rather than bounce the user back with a generic "already
  // exists" error, draw one fresh number from the atomic sequence and retry once before giving up.
  if (error?.code === "23505") {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id, project_number")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string; project_number: string }>();

    if (project) {
      try {
        const generated = await generateDocumentNumber(supabase, {
          organizationId: project.organization_id,
          projectId,
          docType: "itp",
          projectNumber: project.project_number,
        });
        numberToUse = generated.documentNumber;
        ({ data: itp, error } = await supabase
          .from("itps")
          .insert({
            project_id: projectId,
            itp_number: numberToUse,
            title,
            applicable_standard: applicableStandard || null,
            prepared_by: user?.id ?? null,
          })
          .select("id")
          .single());
      } catch (err) {
        console.error("[itp-draft] Could not auto-retry with a fresh ITP number:", err);
      }
    }
  }

  if (error || !itp) {
    if (error?.code === "23505") {
      return {
        error: `An ITP with that number already exists for this project (tried "${numberToUse}"). Please choose a different number and try again.`,
      };
    }
    return { error: "Could not create the ITP. Check you have permission and try again." };
  }

  // The model's own section/item numbers can repeat or be zero, which would break the unique
  // (itp, section number) key or collapse two activities into one. Number sections 1..n in order and
  // make activity numbers unique within their section.
  for (const [sectionIndex, section] of draft.sections.entries()) {
    section.sectionNumber = sectionIndex + 1;
    const seenNumbers = new Set<string>();
    for (const item of section.items) {
      let candidate = item.itemNumber;
      let suffix = 2;
      while (candidate && seenNumbers.has(candidate)) {
        candidate = `${item.itemNumber}-${suffix++}`;
      }
      item.itemNumber = candidate;
      if (candidate) seenNumbers.add(candidate);
      item.evidenceType = item.evidenceType === 2 || item.evidenceType === 3 ? item.evidenceType : 1;
    }
  }

  const { data: newSections, error: sectionsError } = await supabase
    .from("itp_sections")
    .insert(
      draft.sections.map((s, i) => ({
        itp_id: itp.id,
        section_number: i + 1,
        title: s.title || `Section ${i + 1}`,
        sort_order: i,
      }))
    )
    .select("id, section_number");

  if (sectionsError || !newSections) {
    await supabase.from("itps").delete().eq("id", itp.id);
    return { error: "The ITP could not be created because its sections could not be added from the draft. Nothing was saved — please try again." };
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
  const itemsBySectionNumber = new Map(draft.sections.map((s, i) => [i + 1, s.items]));

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
    await supabase.from("itps").delete().eq("id", itp.id);
    return { error: "The draft had no valid activities to add, so no ITP was created." };
  }

  const { data: newItems, error: itemsError } = await supabase
    .from("itp_items")
    .insert(itemsToInsert)
    .select("id, section_id, item_number");

  if (itemsError || !newItems) {
    await supabase.from("itps").delete().eq("id", itp.id);
    return { error: "The ITP could not be created because its activities could not be added from the draft. Nothing was saved — please try again." };
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
    // Only keep suggestions that point at a real party on THIS project and a level code this
    // organisation actually has — one bad suggestion would otherwise make the database reject the
    // whole batch and silently drop every sign-off level. Not a hard failure: the grid stays editable.
    const { data: projectOrg } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string }>();
    const [{ data: projectParties }, { data: levelTypes }] = await Promise.all([
      supabase.from("project_parties").select("id").eq("project_id", projectId).returns<{ id: string }[]>(),
      supabase
        .from("intervention_level_types")
        .select("code")
        .eq("organization_id", projectOrg?.organization_id ?? "")
        .returns<{ code: string }[]>(),
    ]);
    const validParties = new Set((projectParties ?? []).map((p) => p.id));
    const validCodes = new Set((levelTypes ?? []).map((l) => l.code));
    const validInterventions = interventionsToInsert.filter((i) => validParties.has(i.project_party_id) && validCodes.has(i.intervention));
    if (validInterventions.length > 0) {
      await supabase.from("activity_party_intervention").upsert(validInterventions, { onConflict: "itp_item_id,project_party_id" });
    }
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
      itpNumber: numberToUse,
      projectId,
      organizationId: projectForChecklists.organization_id,
      userId: user?.id ?? null,
    });

    // Found missing in a self-review audit: unlike createItpAction ("created") and
    // copyMasterTemplateToItpAction ("created_from_master_template"), this third ITP-creation path
    // had no audit event at all. Best-effort, never blocks the redirect below.
    try {
      await recordAuditEvent(supabase, {
        organizationId: projectForChecklists.organization_id,
        projectId,
        entityType: "itp",
        entityId: itp.id,
        action: "created_from_ai_draft",
        actorId: user?.id ?? null,
        summary: `ITP ${numberToUse} "${title}" created from an AI draft`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  redirect(`/inspect/itps/${itp.id}`);
}
