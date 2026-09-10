import type {
  AiProvider,
  CheckConsistencyInput,
  DraftNcrDescriptionInput,
  DraftNcrDescriptionResult,
  GenerateItpDraftInput,
  ItpDraftResult,
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
  acceptance_criteria: string;
  evidence_type: number;
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

export class GeminiProvider implements AiProvider {
  async generateItpDraft(input: GenerateItpDraftInput): Promise<ItpDraftResult> {
    const partiesList = input.projectParties
      .map((p) => `- id: ${p.id}, type: ${p.partyType}, name: ${p.name}`)
      .join("\n");

    const prompt = [
      "You are assisting a quality-inspection engineer drafting an Inspection & Test Plan (ITP).",
      "Given the spec/scope description below, produce a JSON object (and ONLY a JSON object, no",
      "markdown fences) with this exact shape:",
      `{"sections":[{"section_number":number,"title":string,"items":[{"item_number":string,`,
      `"activity":string,"acceptance_criteria":string,"evidence_type":1|2|3,`,
      `"suggested_interventions":[{"project_party_id":string,"intervention":"H"|"W"|"R"|"S","reason":string}]}]}]}`,
      "evidence_type: 1 = checklist, 2 = document upload, 3 = measurement record.",
      "intervention: H = Hold, W = Witness, R = Review, S = Surveillance.",
      "Only use project_party_id values from this list of parties on the project (omit",
      "suggested_interventions for an item if no party listing applies):",
      partiesList || "(no parties recorded on this project yet)",
      "",
      "Spec/scope description:",
      input.specDescription,
    ].join("\n");

    const text = await generateContent("heavy", prompt, true);
    const raw = parseJson<RawItpDraft>(text, "the ITP draft");

    if (!Array.isArray(raw.sections)) {
      throw new Error("AI response for the ITP draft was missing its sections list.");
    }

    return {
      sections: raw.sections.map((s) => ({
        sectionNumber: Number(s.section_number) || 0,
        title: String(s.title ?? "Untitled section"),
        items: Array.isArray(s.items)
          ? s.items.map((i) => ({
              itemNumber: String(i.item_number ?? ""),
              activity: String(i.activity ?? ""),
              acceptanceCriteria: String(i.acceptance_criteria ?? ""),
              evidenceType: ([1, 2, 3] as const).includes(i.evidence_type as 1 | 2 | 3)
                ? (i.evidence_type as 1 | 2 | 3)
                : 1,
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
}

export const geminiProvider: AiProvider = new GeminiProvider();
