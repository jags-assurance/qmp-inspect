import type {
  AiProvider,
  ChecklistItemDraft,
  CheckConsistencyInput,
  DraftNcrDescriptionInput,
  DraftNcrDescriptionResult,
  DraftReportNarrativeInput,
  GenerateChecklistItemsInput,
  GenerateItpDraftInput,
  ItpDraftResult,
  SuggestRootCauseInput,
} from "@/lib/ai/provider";

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
}

export const geminiProvider: AiProvider = new GeminiProvider();
