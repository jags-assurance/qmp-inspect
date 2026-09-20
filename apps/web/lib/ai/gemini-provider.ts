import type {
  AiProvider,
  ChecklistItemDraft,
  CheckConsistencyInput,
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
  sections: RawItpDraftSection[];
}

const VALID_INTERVENTIONS = new Set(["H", "W", "R", "S"]);

// Caps the combined source-document text sent in one generation call — several full specs
// concatenated could otherwise blow well past a reasonable prompt size. Per-document extraction
// already caps at 120k chars (lib/vault/extract-text.ts); this is the additional cross-document
// budget so a 5-document multi-discipline generation still fits comfortably.
const MAX_COMBINED_SOURCE_CHARS = 300_000;

function buildSourceDocumentsBlock(documents: GenerateItpDraftInput["sourceDocuments"]): string {
  if (documents.length === 0) return "(no source documents attached — draft from the additional instructions alone)";

  let budget = MAX_COMBINED_SOURCE_CHARS;
  const blocks: string[] = [];
  for (const doc of documents) {
    if (budget <= 0) {
      blocks.push(`--- ${doc.title} (${doc.category}) --- [omitted: combined source text limit reached]`);
      continue;
    }
    const text = doc.text.length > budget ? doc.text.slice(0, budget) : doc.text;
    budget -= text.length;
    blocks.push(`--- ${doc.title} (${doc.category}) ---\n${text}`);
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
      "the documents. If the documents cover more than one discipline (e.g. civil AND electrical),",
      "cover all of them, tagging each activity with the correct discipline.",
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
      "  clause / standard / drawing note it's drawn from), acceptance_criteria (specific,",
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
      "Return ONLY a JSON object (no markdown fences, no commentary) with this exact shape:",
      `{"sections":[{"section_number":number,"title":string,"items":[{"item_number":string,`,
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
}

export const geminiProvider: AiProvider = new GeminiProvider();
