import type {
  AiProvider,
  AskProjectQuestionInput,
  ChecklistItemDraft,
  CheckConsistencyInput,
  CleanUpTextInput,
  DraftNcrDescriptionInput,
  DraftNcrDescriptionResult,
  DraftReportNarrativeInput,
  ExtractedCalibrationRow,
  ExtractedMaterialRow,
  ExtractedWelderRow,
  ExtractRegisterInput,
  GenerateChecklistItemsInput,
  GenerateItpDraftInput,
  ItpDraftResult,
  StandaloneMeasurementSuggestion,
  SuggestRootCauseInput,
  SuggestStandaloneMeasurementsInput,
  SummarizeReportPackInput,
  TranslateTextInput,
} from "@/lib/ai/provider";
import type { AiFeature } from "@/lib/ai/log";

// Gemini REST API via a raw fetch wrapper — deliberately not the `@google/generative-ai` package.
// The app makes exactly three narrow, single-turn "send a prompt, get text back" calls; a typed
// fetch wrapper covers that with no new dependency, no SDK version to track, and no surface area
// beyond what's actually used. Revisit only if a future feature needs streaming, chat history, or
// function-calling — none of which any of R34-R43/R82-R84/R108-R111 require.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiTier = "heavy" | "light";

function modelFor(tier: GeminiTier): string {
  const model = tier === "heavy" ? process.env.GEMINI_MODEL_HEAVY : process.env.GEMINI_MODEL_LIGHT;
  if (!model) {
    throw new Error(`Missing environment variable for Gemini ${tier} model.`);
  }
  return model;
}

// Which tier each feature's prompt actually calls (see the `generateContent("heavy"|"light", ...)`
// call inside each method below) — exposed so a caller can resolve "which model actually produced
// this draft" for the audit-trail log (lib/ai/log.ts's logAiUsage) without a network round trip.
const FEATURE_TIER: Record<AiFeature, GeminiTier> = {
  itp_draft: "heavy",
  checklist_generation: "light",
  ncr_description_draft: "light",
  checklist_consistency_check: "light",
  report_narrative_draft: "light",
  ncr_root_cause_suggestion: "light",
  standalone_measurement_suggestion: "light",
  calibration_register_extraction: "light",
  welder_register_extraction: "light",
  material_register_extraction: "light",
  content_translation: "light",
  project_qa: "light",
  text_cleanup: "light",
  report_pack_summary: "light",
};

/** The model id actually in effect for a given feature right now (e.g. "gemini-2.5-pro") — for the
 *  audit-trail log, not for constructing requests (each method already resolves its own via
 *  generateContent -> modelFor). */
export function getGeminiModel(feature: AiFeature): string {
  return modelFor(FEATURE_TIER[feature]);
}

// Bumped by hand whenever a feature's prompt wording below changes meaningfully — lets the
// audit-trail log tell two drafts of the same feature apart if the prompt was later revised, per the
// client's "store prompt version" requirement. Not tied to package/app versioning.
export const PROMPT_VERSIONS: Record<AiFeature, string> = {
  itp_draft: "itp-draft-v1",
  checklist_generation: "checklist-items-v1",
  ncr_description_draft: "ncr-description-v1",
  checklist_consistency_check: "consistency-check-v1",
  report_narrative_draft: "report-narrative-v1",
  ncr_root_cause_suggestion: "ncr-root-cause-v1",
  standalone_measurement_suggestion: "standalone-measurements-v1",
  calibration_register_extraction: "calibration-extraction-v1",
  welder_register_extraction: "welder-extraction-v1",
  material_register_extraction: "material-extraction-v1",
  content_translation: "content-translation-v1",
  project_qa: "project-qa-v1",
  text_cleanup: "text-cleanup-v1",
  report_pack_summary: "report-pack-summary-v1",
};

interface GeminiGenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * Calls Gemini's generateContent REST endpoint with a single user turn and, optionally, a
 * constrained JSON response schema — the same "ask for exact-shape JSON" pattern the client's own
 * AI-Prompts-and-Outputs doc specifies, just pointed at Gemini instead of Claude. Returns the raw
 * text back; callers that expect JSON are responsible for parsing it (see parseJson below) so a
 * malformed response surfaces as a clear, specific error rather than a crash.
 */
async function generateContent(tier: GeminiTier, prompt: string, expectJson: boolean): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = modelFor(tier);
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(expectJson ? { generationConfig: { responseMimeType: "application/json" } } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const body = (await response.json()) as GeminiGenerateContentResponse;
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}

function parseJson<T>(text: string, context: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`AI response for ${context} was not valid JSON — could not build a draft from it.`);
  }
}

interface RawItpDraftIntervention {
  project_party_id: string;
  intervention: string;
  reason: string;
}
interface RawItpDraftItem {
  item_number: string;
  activity: string;
  reference_spec?: string;
  acceptance_criteria: string;
  method?: string;
  frequency?: string;
  evidence_type: number;
  discipline_code?: string | null;
  suggested_interventions: RawItpDraftIntervention[];
}
interface RawItpDraftSection {
  section_number: number;
  title: string;
  items: RawItpDraftItem[];
}
interface RawItpDraft {
  suggested_title?: string | null;
  suggested_applicable_standard?: string | null;
  sections: RawItpDraftSection[];
}

const VALID_INTERVENTIONS = new Set(["H", "W", "R", "S"]);

// Caps the combined source-document text sent in one generation call — several full specs
// concatenated could otherwise blow well past a reasonable prompt size. Per-document extraction
// already caps at 120k chars (lib/vault/extract-text.ts); this is the additional cross-document
// budget so a 5-document multi-discipline generation still fits comfortably.
const MAX_COMBINED_SOURCE_CHARS = 300_000;

/** Header line for one source-document block: title, its OWN controlled document number/revision
 *  (when the vault record has one — see ItpSourceDocument's doc comment for why this matters more
 *  than letting the AI re-derive a document's identity from wherever it happens to restate its own
 *  number inside its body text), and its vault category — the category drives the ROLE rules in the
 *  prompt below (a Specification's stated tolerance outranks a Standard's generic one; a Method
 *  Statement's sequence informs method/frequency and hold points, not acceptance values). */
function sourceDocumentHeader(doc: GenerateItpDraftInput["sourceDocuments"][number]): string {
  const ref = [doc.documentReference, doc.revision ? `Rev ${doc.revision}` : null].filter(Boolean).join(" ");
  return `--- DOC-REF: ${ref || "(no controlled document number on file)"} | TITLE: ${doc.title} | CATEGORY: ${doc.category} ---`;
}

function buildSourceDocumentsBlock(documents: GenerateItpDraftInput["sourceDocuments"]): string {
  if (documents.length === 0) return "(no source documents attached — draft from the additional instructions alone)";

  let budget = MAX_COMBINED_SOURCE_CHARS;
  const blocks: string[] = [];
  for (const doc of documents) {
    if (budget <= 0) {
      blocks.push(`${sourceDocumentHeader(doc)} [omitted: combined source text limit reached]`);
      continue;
    }
    const text = doc.text.length > budget ? doc.text.slice(0, budget) : doc.text;
    budget -= text.length;
    blocks.push(`${sourceDocumentHeader(doc)}\n${text}`);
  }
  return blocks.join("\n\n");
}

export class GeminiProvider implements AiProvider {
  async generateItpDraft(input: GenerateItpDraftInput): Promise<ItpDraftResult> {
    const partiesList = input.projectParties
      .map((p) => `- id: ${p.id}, type: ${p.partyType}, name: ${p.name}`)
      .join("\n");
    const disciplinesList = input.disciplines.map((d) => `${d.code} (${d.name})`).join(", ");

    const prompt = [
      "You are a senior multi-discipline QA/QC engineer preparing an Inspection & Test Plan (ITP)",
      "for a real construction/industrial project, to the standard a client and third-party",
      "inspector would actually accept and work from on site.",
      "",
      "Read the SOURCE DOCUMENTS below (specifications, standards, drawings notes, method",
      "statements — whatever was attached) and cross-reference the applicable standards they",
      "cite. Produce a CONCISE, field-usable, industry-standard ITP grounded in what those",
      "documents actually require — not a generic template, and not an exhaustive restatement of",
      "the documents. These are REAL project documents, not clean templates written for this tool —",
      "expect inconsistent numbering, scanned-document noise, page headers/footers repeated inline,",
      "and gaps in a lettered/numbered sequence (e.g. a list that jumps from C to F) — extract the",
      "genuine requirement despite the formatting noise; never turn a page header, a signature block,",
      "or a document-control stamp into an activity.",
      "",
      "MULTI-DISCIPLINE / MULTI-DOCUMENT RULES (this is very often a real multi-disciplinary project,",
      "not a single-trade one — treat this as the normal case, not an edge case):",
      "- If the documents cover more than one discipline (e.g. civil AND electrical AND mechanical),",
      "  cover all of them in one ITP, tagging each activity with the discipline it actually belongs",
      "  to. When a single activity spans a boundary (e.g. an electrical device fixed to a civil",
      "  structure), tag it with the discipline of the trade actually being INSPECTED at that point,",
      "  not the discipline of whichever document it happened to come from.",
      "- Each source document's block below is headed 'DOC-REF: ... | TITLE: ... | CATEGORY: ...'.",
      "  Every activity's reference_spec MUST cite that document's own DOC-REF (its controlled",
      "  document number/revision) together with the specific clause/step number inside it — e.g.",
      "  '25045-C2000-20-3GS-E-049 Rev 00, 2.5.1(9)', never a bare clause number like '2.5.1(9)' on",
      "  its own. This is required, not optional: with more than one document attached, two",
      "  documents can easily share the same clause numbering, and a bare clause number would leave",
      "  it genuinely ambiguous which document it came from.",
      "- CATEGORY tells you the document's ROLE — weight them accordingly:",
      "  'Specifications' and 'Method Statements' are the primary source for concrete, project-",
      "  specific acceptance_criteria (their stated tolerances/values/sequence override a generic",
      "  code's default).",
      "  'Standards & Codes' documents (e.g. a national/international code) are supporting",
      "  reference material, not a substitute for a project-specific value — cite a standard",
      "  alongside a project document's own stated criterion, but never invent a numeric acceptance",
      "  value SOLELY from a generic standard when no project-specific spec/method statement in the",
      "  attached set actually states one for this project; if that happens, say so plainly in",
      "  acceptance_criteria (e.g. 'Per [standard] — project-specific value not yet confirmed in the",
      "  attached documents') rather than presenting the standard's generic figure as this project's",
      "  own accepted value.",
      "  'Method Statements' additionally drive method/frequency and where the real hold/witness",
      "  points in the physical sequence are (e.g. before cover-up, before energisation) — use their",
      "  described work sequence for that, not just their acceptance wording.",
      "- If two attached documents genuinely conflict (different values or requirements for the same",
      "  thing — e.g. two revisions of the same spec, or a project spec vs. a general standard that",
      "  disagrees with it), do not silently pick one and hide the discrepancy: state both in",
      "  acceptance_criteria and note which should govern if that's determinable (e.g. the more",
      "  recent revision, or the project-specific document over the generic standard).",
      "",
      "RULES:",
      "- Use these four standard sections, in this order: 1. Submittals & Materials,",
      "  2. Installation/Execution, 3. Testing & Commissioning, 4. Handover.",
      "- Every activity must genuinely need an inspection, test, hold/witness point, or record —",
      "  skip definitions, background and general narrative text from the source documents.",
      "- Combine minor/related checks into one activity rather than listing every clause",
      "  separately; prefer 4-8 well-formed activities per section over a long thin list, but do",
      "  NOT drop a distinct discipline's requirements just to keep the count low — add activities",
      "  as genuinely needed across disciplines.",
      "- For each activity give: item_number (e.g. \"1.1\"), activity, reference_spec (the spec",
      "  clause / standard / drawing note it's drawn from — see the MULTI-DISCIPLINE rules above for",
      "  the required document-number + clause format), acceptance_criteria (specific,",
      "  measurable where the source gives a tolerance or value — don't invent numbers the source",
      "  doesn't state), method (how it's checked/tested), frequency (how often/what sample),",
      "  evidence_type (1 = checklist he inspector fills in on site, 2 = document/certificate",
      "  upload, 3 = a measurement/test-result record), and discipline_code.",
      `- discipline_code must be one of: ${disciplinesList || "(no disciplines configured)"}, or null if the`,
      "  activity is genuinely cross-discipline/general.",
      "- For each activity, suggest a per-party intervention (H = Hold: work must stop until that",
      "  party signs off; W = Witness: that party is notified and may attend, but a wait period can",
      "  auto-release it; R = Review: reviews records/evidence, no site presence implied;",
      "  S = Surveillance: general oversight, not a stop point) only for parties that plausibly",
      "  have a role in that specific check, with a one-line reason. Do not assign a Hold to every",
      "  party on every activity — Holds are for the genuinely critical points (e.g. cover-up",
      "  inspections, energisation, load tests), reserved for maybe 10-20% of activities; most",
      "  activities should carry Witness/Review/Surveillance or nothing at all for a given party.",
      "",
      "Also suggest a title and an applicable standard for the ITP as a whole, drawn from what the",
      "source documents actually cover — suggested_title should read like a real controlled-document",
      "title (e.g. \"Electrical Installation & Testing\" or \"Civil Works — Foundations & Structural",
      "Concrete\"), not a restatement of a filename. suggested_applicable_standard should be the single",
      "standard the documents cite most centrally (e.g. \"IEC 61439\"), or null if none is clearly",
      "dominant — never invent one that isn't actually referenced in the source documents.",
      "",
      "Return ONLY a JSON object (no markdown fences, no commentary) with this exact shape:",
      `{"suggested_title":string|null,"suggested_applicable_standard":string|null,`,
      `"sections":[{"section_number":number,"title":string,"items":[{"item_number":string,`,
      `"activity":string,"reference_spec":string,"acceptance_criteria":string,"method":string,`,
      `"frequency":string,"evidence_type":1|2|3,"discipline_code":string|null,`,
      `"suggested_interventions":[{"project_party_id":string,"intervention":"H"|"W"|"R"|"S","reason":string}]}]}]}`,
      "",
      "Only use project_party_id values from this list of parties on the project (omit",
      "suggested_interventions for an item if no party listing applies):",
      partiesList || "(no parties recorded on this project yet)",
      "",
      input.additionalInstructions
        ? `ADDITIONAL INSTRUCTIONS FROM THE ENGINEER: ${input.additionalInstructions}\n`
        : "",
      "SOURCE DOCUMENTS:",
      buildSourceDocumentsBlock(input.sourceDocuments),
    ].join("\n");

    const text = await generateContent("heavy", prompt, true);
    const raw = parseJson<RawItpDraft>(text, "the ITP draft");

    if (!Array.isArray(raw.sections)) {
      throw new Error("AI response for the ITP draft was missing its sections list.");
    }

    const validDisciplineCodes = new Set(input.disciplines.map((d) => d.code));

    return {
      suggestedTitle: typeof raw.suggested_title === "string" && raw.suggested_title.trim() ? raw.suggested_title.trim() : null,
      suggestedApplicableStandard:
        typeof raw.suggested_applicable_standard === "string" && raw.suggested_applicable_standard.trim()
          ? raw.suggested_applicable_standard.trim()
          : null,
      sections: raw.sections.map((s) => ({
        sectionNumber: Number(s.section_number) || 0,
        title: String(s.title ?? "Untitled section"),
        items: Array.isArray(s.items)
          ? s.items.map((i) => ({
              itemNumber: String(i.item_number ?? ""),
              activity: String(i.activity ?? ""),
              referenceSpec: String(i.reference_spec ?? ""),
              acceptanceCriteria: String(i.acceptance_criteria ?? ""),
              method: String(i.method ?? ""),
              frequency: String(i.frequency ?? ""),
              evidenceType: ([1, 2, 3] as const).includes(i.evidence_type as 1 | 2 | 3)
                ? (i.evidence_type as 1 | 2 | 3)
                : 1,
              disciplineCode:
                typeof i.discipline_code === "string" && validDisciplineCodes.has(i.discipline_code)
                  ? i.discipline_code
                  : null,
              suggestedInterventions: Array.isArray(i.suggested_interventions)
                ? i.suggested_interventions
                    .filter((si) => VALID_INTERVENTIONS.has(si.intervention))
                    .map((si) => ({
                      projectPartyId: String(si.project_party_id ?? ""),
                      intervention: si.intervention as "H" | "W" | "R" | "S",
                      reason: String(si.reason ?? ""),
                    }))
                : [],
            }))
          : [],
      })),
    };
  }

  async generateChecklistItems(input: GenerateChecklistItemsInput): Promise<ChecklistItemDraft[]> {
    const prompt = [
      "You are a QA/QC engineer creating a field inspection CHECKLIST for one ITP activity, to the",
      "standard an inspector would actually use on a tablet on site.",
      "Based on the activity and its acceptance criteria/method/frequency below (and the source",
      "spec excerpt, if given), list the specific items an inspector must physically check. Each",
      "item must be answerable Yes / No / N-A on its own — no compound items.",
      "",
      "RULES:",
      "- 5-12 items. Concise, specific, field-checkable — not a restatement of the activity as one",
      "  item.",
      "- Cover the acceptance criteria comprehensively: if it states a tolerance, a required",
      "  document, or a sequence of steps, each becomes its own checkable item.",
      "- Mark an item mandatory:true only if failing it should fail the inspection; mandatory:false",
      "  for a supporting/administrative check (e.g. \"delivery ticket attached\").",
      "- Do not invent acceptance values the source doesn't state.",
      "",
      'Return ONLY a JSON object (no markdown fences): {"items":[{"text":string,"mandatory":boolean}]}',
      "",
      `ACTIVITY: ${input.activity}`,
      input.referenceSpec ? `REFERENCE: ${input.referenceSpec}` : "",
      input.acceptanceCriteria ? `ACCEPTANCE CRITERIA: ${input.acceptanceCriteria}` : "",
      input.method ? `METHOD: ${input.method}` : "",
      input.frequency ? `FREQUENCY: ${input.frequency}` : "",
      input.sourceExcerpt ? `SOURCE SPEC EXCERPT:\n${input.sourceExcerpt.slice(0, 6000)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const text = await generateContent("light", prompt, true);
    const raw = parseJson<{ items: { text: string; mandatory: boolean }[] }>(text, "the checklist draft");

    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      throw new Error("AI response for the checklist draft had no items.");
    }

    return raw.items
      .filter((it) => it.text && String(it.text).trim())
      .map((it) => ({ text: String(it.text).trim(), mandatory: it.mandatory !== false }));
  }

  async draftNcrDescription(input: DraftNcrDescriptionInput): Promise<DraftNcrDescriptionResult> {
    const prompt = [
      "You are assisting a quality inspector drafting a non-conformance report (NCR) from raw",
      "field notes. Produce a JSON object (and ONLY a JSON object, no markdown fences) with this",
      'exact shape: {"description":string,"requirement_not_met":string}.',
      "description: a clear, factual, professional statement of what was observed / not conforming,",
      "written in the third person, based only on the notes given — do not invent facts not present",
      "in the notes.",
      "requirement_not_met: the spec clause, drawing note, or acceptance criteria the notes suggest",
      "was not met, or an empty string if the notes don't identify one.",
      "",
      "Field notes:",
      input.notes,
    ].join("\n");

    const text = await generateContent("light", prompt, true);
    const raw = parseJson<{ description: string; requirement_not_met: string }>(text, "the NCR draft");

    return {
      description: String(raw.description ?? ""),
      requirementNotMet: String(raw.requirement_not_met ?? ""),
    };
  }

  async checkConsistency(input: CheckConsistencyInput): Promise<string[]> {
    const responsesList = input.responses
      .map((r) => `- "${r.itemDescription}": ${r.result}${r.comment ? ` (comment: ${r.comment})` : ""}`)
      .join("\n");

    const prompt = [
      "You are reviewing a completed inspection checklist for internal consistency before an",
      "inspector signs it off. The ITP item's acceptance criteria is given below, followed by the",
      "checklist responses recorded against it. Flag ONLY responses that plainly contradict the",
      "acceptance criteria or another response's comment (e.g. a numeric tolerance stated in a",
      "comment that a 'yes' result doesn't actually satisfy). Do not flag anything you are not",
      "confident is a real inconsistency.",
      "Produce a JSON object (and ONLY a JSON object, no markdown fences) with this exact shape:",
      '{"flags":[string]}. Each string is a short, plain-language note for the inspector. Return',
      '{"flags":[]} if nothing looks inconsistent.',
      "",
      "Acceptance criteria:",
      input.acceptanceCriteria || "(none recorded)",
      "",
      "Checklist responses:",
      responsesList,
    ].join("\n");

    const text = await generateContent("light", prompt, true);
    const raw = parseJson<{ flags: string[] }>(text, "the consistency check");

    return Array.isArray(raw.flags) ? raw.flags.map((f) => String(f)) : [];
  }

  async draftReportNarrative(input: DraftReportNarrativeInput): Promise<string> {
    const reportLabel = input.reportType === "fat" ? "FAT / standalone assignment report" : "inspection report";
    const factsList = input.facts.length > 0 ? input.facts.map((f) => `- ${f}`).join("\n") : "(no additional facts given)";

    const prompt = [
      `You are a QA/QC engineer writing the conclusion paragraph of a ${reportLabel}.`,
      "Write a concise, professional, factual summary (2-4 sentences): what was inspected/tested,",
      "the overall outcome, and any key facts given below. Use ONLY the facts provided — never",
      "invent a number, name, or finding that isn't stated. Do not assign blame or speculate about",
      "causes. Write in the third person, past tense, as it will appear on an issued document.",
      "",
      "Return plain text only — no markdown, no headings, no quotation marks around the output.",
      "",
      `Subject: ${input.subject}`,
      `Project: ${input.projectName}`,
      `Outcome: ${input.outcome ?? "not yet determined"}`,
      "Facts:",
      factsList,
    ].join("\n");

    const text = await generateContent("light", prompt, false);
    return text.trim();
  }

  async suggestRootCause(input: SuggestRootCauseInput): Promise<string> {
    const prompt = [
      "You are a QA/QC engineer suggesting the LIKELY root cause of a non-conformance, for an",
      "inspector to review before writing the NCR's formal root cause.",
      "Based only on the description and requirement below, suggest the most probable root cause",
      "(e.g. workmanship error, incorrect material, missing/misread drawing revision, inadequate",
      "method statement, equipment fault, training gap). Be specific to what's actually described —",
      "do not invent details the description doesn't support. If the description genuinely doesn't",
      "give enough information to suggest a cause, say so plainly instead of guessing.",
      "",
      "Return plain text only: 1-2 sentences, third person, no markdown, no quotation marks.",
      "",
      `Severity: ${input.severity}`,
      `Description: ${input.description}`,
      `Requirement not met: ${input.requirementNotMet || "(not recorded)"}`,
    ].join("\n");

    const text = await generateContent("light", prompt, false);
    return text.trim();
  }

  async suggestStandaloneMeasurements(
    input: SuggestStandaloneMeasurementsInput
  ): Promise<StandaloneMeasurementSuggestion[]> {
    const typeLabel =
      {
        fat: "Factory Acceptance Test (FAT)",
        witness_inspection: "Witness Inspection",
        specific_test: "Specific Test",
        pre_shipment: "Pre-Shipment Inspection",
      }[input.assignmentType] ?? input.assignmentType;

    const prompt = [
      `You are a senior QA/QC inspector preparing the measurement/test-parameter sheet for a`,
      `${typeLabel}, to the standard a real inspector would fill in on site — specific to the`,
      "actual equipment given below, not a generic template.",
      "",
      "Based on the equipment description, manufacturer/model and standard/spec reference given",
      "below, list the specific measurements, dimensional checks and test parameters a competent",
      "inspector would actually record for this equipment type.",
      "",
      "RULES:",
      "- 3-8 suggestions. Each must be a specific, physically checkable parameter for THIS",
      "  equipment (e.g. for a pressure safety valve: set pressure, reseat pressure, seat",
      "  tightness/leak rate, body hydrostatic test pressure, blowdown — not vague items like",
      "  \"general condition\" or \"check equipment\").",
      "- Only give a numeric nominal value and tolerance when the standard/equipment description",
      "  actually supports one (e.g. a stated set pressure or a value the reference standard",
      "  fixes). Do NOT invent a number that isn't grounded in what's given — if a real value",
      "  can't be grounded, leave nominal and tolerance as empty strings and let the description",
      "  itself state the check qualitatively (e.g. \"Visual inspection of weld seams for defects\").",
      "- unit should be a real engineering unit (e.g. \"bar\", \"mm\", \"Nm\", \"°C\") or an empty string",
      "  if the check has no numeric unit (e.g. a pass/fail visual or functional check).",
      "",
      'Return ONLY a JSON object (no markdown fences, no commentary): {"suggestions":[{"description":string,"nominal":string,"tolerance":string,"unit":string}]}',
      "",
      `ASSIGNMENT TYPE: ${typeLabel}`,
      `EQUIPMENT: ${input.equipmentDescription}`,
      input.manufacturer ? `MANUFACTURER: ${input.manufacturer}` : "",
      input.model ? `MODEL: ${input.model}` : "",
      input.standardReference ? `STANDARD / SPEC REFERENCE: ${input.standardReference}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const text = await generateContent("light", prompt, true);
    const raw = parseJson<{ suggestions: { description: string; nominal?: string; tolerance?: string; unit?: string }[] }>(
      text,
      "the measurement suggestions"
    );

    if (!Array.isArray(raw.suggestions) || raw.suggestions.length === 0) {
      throw new Error("AI response for the measurement suggestions had no items.");
    }

    return raw.suggestions
      .filter((s) => s.description && String(s.description).trim())
      .map((s) => ({
        description: String(s.description).trim(),
        nominal: String(s.nominal ?? "").trim(),
        tolerance: String(s.tolerance ?? "").trim(),
        unit: String(s.unit ?? "").trim(),
      }));
  }

  // Shared "never invent a missing field" rule text for the three register-extraction methods
  // below — the one non-negotiable behavior the client's register sample pack calls out
  // explicitly: "An AI extraction must return null for a missing field. It must not infer
  // certificate numbers, dates, qualification range, heat number or release status."
  private static readonly EXTRACTION_RULES = [
    "RULES (non-negotiable):",
    "- Extract ONLY what the source text actually states. If a field isn't stated, or the text says",
    "  it's illegible/unreadable/missing, return null for that field — never guess, never infer from",
    "  a 'normal' interval, never fill in today's date or a plausible-looking value.",
    "- One row per distinct instrument/welder/material the text describes. Do not merge or split an",
    "  entry the source presents as one item.",
    "- Do not compute or state any status, release, or use-allowed judgement — that is a human",
    "  document-controller decision, never this extraction's job.",
  ].join("\n");

  async extractCalibrationRows(input: ExtractRegisterInput): Promise<ExtractedCalibrationRow[]> {
    const prompt = [
      "You are extracting rows for a CALIBRATION REGISTER from raw certificate/document text.",
      "For each calibrated instrument described, extract: instrument name/type, certificate number,",
      "calibration date, and due/next-calibration date.",
      "",
      GeminiProvider.EXTRACTION_RULES,
      "",
      'Return ONLY a JSON object (no markdown fences): {"rows":[{"instrument_name":string,"cert_number":string|null,"cal_date":string|null,"due_date":string|null}]}',
      "Dates must be ISO format (YYYY-MM-DD) when stated, or null.",
      "",
      "SOURCE TEXT:",
      input.sourceText.slice(0, 12000),
    ].join("\n");

    const text = await generateContent("light", prompt, true);
    const raw = parseJson<{
      rows: { instrument_name: string; cert_number: string | null; cal_date: string | null; due_date: string | null }[];
    }>(text, "the calibration register extraction");

    if (!Array.isArray(raw.rows)) return [];
    return raw.rows
      .filter((r) => r.instrument_name && String(r.instrument_name).trim())
      .map((r) => ({
        instrumentName: String(r.instrument_name).trim(),
        certNumber: r.cert_number ? String(r.cert_number).trim() : null,
        calDate: r.cal_date ? String(r.cal_date).trim() : null,
        dueDate: r.due_date ? String(r.due_date).trim() : null,
      }));
  }

  async extractWelderRows(input: ExtractRegisterInput): Promise<ExtractedWelderRow[]> {
    const prompt = [
      "You are extracting rows for a WELDER QUALIFICATION REGISTER from raw WPQ (welder performance",
      "qualification) document text.",
      "For each welder described, extract: a welder identifier (ID/name as stated), a combined",
      "process+position summary (e.g. \"GTAW/SMAW, position 6G\"), a combined qualified-range +",
      "continuity-evidence summary, and an expiry date if one is stated.",
      "",
      GeminiProvider.EXTRACTION_RULES,
      "- If continuity evidence or a verified qualification range is NOT confirmed in the text",
      "  (e.g. 'continuity log not attached', 'range must be confirmed'), the combined range field",
      "  must say so explicitly (e.g. \"Range/continuity not confirmed in source\") rather than being",
      "  left blank or guessed — the reviewer needs to see that this is unresolved, not just missing.",
      "",
      'Return ONLY a JSON object (no markdown fences): {"rows":[{"welder_identifier":string,"qualified_wps":string|null,"qualified_ranges":string|null,"expiry_date":string|null}]}',
      "Dates must be ISO format (YYYY-MM-DD) when stated, or null.",
      "",
      "SOURCE TEXT:",
      input.sourceText.slice(0, 12000),
    ].join("\n");

    const text = await generateContent("light", prompt, true);
    const raw = parseJson<{
      rows: { welder_identifier: string; qualified_wps: string | null; qualified_ranges: string | null; expiry_date: string | null }[];
    }>(text, "the welder register extraction");

    if (!Array.isArray(raw.rows)) return [];
    return raw.rows
      .filter((r) => r.welder_identifier && String(r.welder_identifier).trim())
      .map((r) => ({
        welderIdentifier: String(r.welder_identifier).trim(),
        qualifiedWps: r.qualified_wps ? String(r.qualified_wps).trim() : null,
        qualifiedRanges: r.qualified_ranges ? String(r.qualified_ranges).trim() : null,
        expiryDate: r.expiry_date ? String(r.expiry_date).trim() : null,
      }));
  }

  async extractMaterialRows(input: ExtractRegisterInput): Promise<ExtractedMaterialRow[]> {
    const prompt = [
      "You are extracting rows for a MATERIAL TRACEABILITY REGISTER from raw submittal/certificate",
      "document text (CoC, MTC, delivery notes, submittal transmittals).",
      "For each material/delivery described, extract: material description, submittal reference,",
      "heat number, batch number, purchase-order/delivery-note reference, and certificate reference",
      "(CoC or MTC number).",
      "",
      GeminiProvider.EXTRACTION_RULES,
      "- If the text explicitly says no certificate was included, or a certificate is missing, that",
      "  is exactly the case where certificate_reference must be null — do not write \"missing\" or",
      "  \"none\" as the value; null means null.",
      "",
      'Return ONLY a JSON object (no markdown fences): {"rows":[{"material_description":string,"submittal_reference":string|null,"heat_number":string|null,"batch_number":string|null,"po_reference":string|null,"certificate_reference":string|null}]}',
      "",
      "SOURCE TEXT:",
      input.sourceText.slice(0, 12000),
    ].join("\n");

    const text = await generateContent("light", prompt, true);
    const raw = parseJson<{
      rows: {
        material_description: string;
        submittal_reference: string | null;
        heat_number: string | null;
        batch_number: string | null;
        po_reference: string | null;
        certificate_reference: string | null;
      }[];
    }>(text, "the material register extraction");

    if (!Array.isArray(raw.rows)) return [];
    return raw.rows
      .filter((r) => r.material_description && String(r.material_description).trim())
      .map((r) => ({
        materialDescription: String(r.material_description).trim(),
        submittalReference: r.submittal_reference ? String(r.submittal_reference).trim() : null,
        heatNumber: r.heat_number ? String(r.heat_number).trim() : null,
        batchNumber: r.batch_number ? String(r.batch_number).trim() : null,
        poReference: r.po_reference ? String(r.po_reference).trim() : null,
        certificateReference: r.certificate_reference ? String(r.certificate_reference).trim() : null,
      }));
  }

  /** R111 (1/4) — translates one piece of real content (an ITP title/scope, an NCR description, a
   *  report narrative, etc.) into another language, for display alongside the original. Plain text
   *  only: no markdown, no commentary, no re-statement of the source language — just the
   *  translation, exactly as the model actually produces it for whatever language was picked. */
  async translateText(input: TranslateTextInput): Promise<string> {
    const prompt = [
      `Translate the following text into ${input.targetLanguage}.`,
      "Preserve the original meaning and register (this is real project/QA documentation content,",
      "not casual writing) and keep any technical terms, standard references, or reference numbers",
      "intact where a translation would lose or garble their meaning.",
      "Return ONLY the translated text — no explanation, no quotation marks, no restating the",
      "source text, no markdown.",
      "",
      "TEXT TO TRANSLATE:",
      input.text,
    ].join("\n");

    const text = await generateContent("light", prompt, false);
    return text.trim();
  }

  /** R111 (2/4) — answers a free-text question about one project, grounded ONLY in the real project
   *  context the caller assembled (see lib/projects/qa-context.ts). If that context genuinely
   *  doesn't contain an answer, the model saying so plainly is the correct, honest outcome — this
   *  method does nothing to prevent or paper over that. */
  async askProjectQuestion(input: AskProjectQuestionInput): Promise<string> {
    const prompt = [
      "You are answering a question about ONE specific construction/industrial QA project, for a",
      "person already working on it. Base your answer ONLY on the PROJECT CONTEXT given below —",
      "real data pulled from this project's ITPs, NCRs and recent inspection records. Never invent a",
      "fact, a number, a name, or a status that isn't in the context given. If the context genuinely",
      "doesn't contain enough information to answer, say so plainly instead of guessing.",
      "",
      "Answer concisely and factually, in plain text (no markdown), as you would speak to a",
      "colleague who already knows the project.",
      "",
      "PROJECT CONTEXT:",
      input.projectContext,
      "",
      `QUESTION: ${input.question}`,
    ].join("\n");

    const text = await generateContent("light", prompt, false);
    return text.trim();
  }

  /** R111 (3/4) — returns a grammar/clarity-cleaned rewrite of a free-text draft the user is already
   *  typing (an NCR description, a report narrative, etc.), for them to explicitly accept or
   *  discard — this never gets applied on its own. Fixes wording only: it must never add, remove or
   *  change a fact, a number, a name, or a finding the original text didn't already state. */
  async cleanUpText(input: CleanUpTextInput): Promise<string> {
    const prompt = [
      "You are cleaning up the wording of a short piece of real QA/QC documentation text — fix",
      "grammar, clarity, and professional tone ONLY. Do not add, remove, or change any fact, number,",
      "name, finding, or meaning the original text doesn't already contain. Do not make it longer",
      "or more elaborate than the original intent — this is a clean-up pass, not a rewrite.",
      "If the text is already clear and correctly worded, return it unchanged.",
      "",
      "Return ONLY the cleaned-up text — no explanation, no quotation marks, no markdown.",
      "",
      "TEXT:",
      input.text,
    ].join("\n");

    const text = await generateContent("light", prompt, false);
    return text.trim();
  }

  /** R111 (4/4) — a few sentences of prose summarising one organisation's already-aggregated report-
   *  pack numbers (the same numbers the PDF/xlsx itself renders — see worker/src/jobs/
   *  reportPackAggregation.ts). Every number is passed in, never invented here; a null rate (not yet
   *  computable, e.g. no inspections yet) is reported as such, not filled in with a guess. */
  async summarizeReportPack(input: SummarizeReportPackInput): Promise<string> {
    const prompt = [
      "You are writing the executive-summary paragraph at the top of a QA/QC client report pack —",
      "the standard a report reader (a client PM, not a QA engineer) would actually read first.",
      "Summarise the real, already-computed numbers below in 3-5 plain-English sentences: overall",
      "quality performance this period, the NCR picture (opened vs. closed — note if the backlog",
      "grew or shrank), and ITP completion progress. Use ONLY the numbers given — never invent a",
      "rate, count, or trend the numbers below don't support, and never speculate about causes you",
      "aren't given evidence for. If a rate is null, say plainly that it isn't yet computable for",
      "this period (e.g. no inspections recorded) rather than omitting or guessing it.",
      "",
      "Return plain text only — no markdown, no headings, no quotation marks.",
      "",
      `Organisation: ${input.organizationName}`,
      `Period: ${input.periodLabel}`,
      `Projects covered: ${input.projectCount}`,
      `First-time pass rate: ${input.firstTimePassRate === null ? "not yet computable" : `${input.firstTimePassRate}%`}`,
      `Inspections completed: ${input.inspectionsCompleted}`,
      `NCRs opened this period: ${input.ncrsOpened}`,
      `NCRs closed this period: ${input.ncrsClosed}`,
      `ITP completion rate: ${input.itpCompletionRate === null ? "not yet computable" : `${input.itpCompletionRate}%`}`,
    ].join("\n");

    const text = await generateContent("light", prompt, false);
    return text.trim();
  }
}

export const geminiProvider: AiProvider = new GeminiProvider();
