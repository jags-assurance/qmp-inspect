// Provider-agnostic AI interface. The client's own spec was written against the Anthropic Claude
// API; this build deliberately uses Gemini instead (see apps/web/lib/ai/gemini-provider.ts), but
// every call site in the app talks to the shapes below, not to Gemini directly — swapping in
// Claude (or any other model) later is a new file that implements this interface, with zero
// changes anywhere else.
//
// Every method here is a pure "ask the model, get a draft back" call. None of them write to the
// database and none of them are the enforcement point for consent/tier gating — that's
// apps/web/lib/ai/gate.ts, which every server action calls before it ever reaches a provider
// method. This file only shapes what a draft looks like.

export interface ItpDraftIntervention {
  projectPartyId: string;
  intervention: "H" | "W" | "R" | "S";
  reason: string;
}

export interface ItpDraftItem {
  itemNumber: string;
  activity: string;
  /** Spec clause / drawing note / standard reference the activity is drawn from, e.g. "Elec Spec 6.2 / IEC 60227". */
  referenceSpec: string;
  acceptanceCriteria: string;
  /** How it's checked, e.g. "Visual + document review", "Megger test". */
  method: string;
  /** How often, e.g. "Per delivery", "Each circuit", "100% of welds". */
  frequency: string;
  evidenceType: 1 | 2 | 3;
  /** One of the project's master discipline codes (e.g. "ELE", "CIV"), or null if not applicable. */
  disciplineCode: string | null;
  suggestedInterventions: ItpDraftIntervention[];
}

export interface ItpDraftSection {
  sectionNumber: number;
  title: string;
  items: ItpDraftItem[];
}

export interface ItpDraftResult {
  sections: ItpDraftSection[];
}

/** One vault document's extracted text, feeding an ITP generation call as real source material. */
export interface ItpSourceDocument {
  title: string;
  /** Human label of the discipline/category this document belongs to, e.g. "Specifications", "Standards & Codes". */
  category: string;
  text: string;
}

export interface GenerateItpDraftInput {
  /** One or more requirement documents pulled from the project vault — the actual grounding for the draft. */
  sourceDocuments: ItpSourceDocument[];
  /** Optional free-text scope/focus notes on top of the source documents (e.g. "electrical works only"). */
  additionalInstructions: string;
  /** Project parties available on this project, so the model can suggest interventions against real ids. */
  projectParties: { id: string; partyType: string; name: string }[];
  /** The organisation's active discipline taxonomy, so the model tags each activity with a real code. */
  disciplines: { code: string; name: string }[];
}

export interface ChecklistItemDraft {
  text: string;
  mandatory: boolean;
}

export interface GenerateChecklistItemsInput {
  activity: string;
  referenceSpec: string;
  acceptanceCriteria: string;
  method: string;
  frequency: string;
  /** Excerpt of the source spec text this activity was drawn from, if the parent ITP was AI-generated from vault documents. */
  sourceExcerpt: string;
}

export interface DraftNcrDescriptionInput {
  notes: string;
}

export interface DraftNcrDescriptionResult {
  description: string;
  requirementNotMet: string;
}

export interface CheckConsistencyInput {
  acceptanceCriteria: string;
  responses: { itemDescription: string; result: "yes" | "no" | "na"; comment: string | null }[];
}

export interface AiProvider {
  generateItpDraft(input: GenerateItpDraftInput): Promise<ItpDraftResult>;
  generateChecklistItems(input: GenerateChecklistItemsInput): Promise<ChecklistItemDraft[]>;
  draftNcrDescription(input: DraftNcrDescriptionInput): Promise<DraftNcrDescriptionResult>;
  checkConsistency(input: CheckConsistencyInput): Promise<string[]>;
}
