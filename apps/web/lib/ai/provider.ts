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
  acceptanceCriteria: string;
  evidenceType: 1 | 2 | 3;
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

export interface GenerateItpDraftInput {
  specDescription: string;
  /** Project parties available on this project, so the model can suggest interventions against real ids. */
  projectParties: { id: string; partyType: string; name: string }[];
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
  draftNcrDescription(input: DraftNcrDescriptionInput): Promise<DraftNcrDescriptionResult>;
  checkConsistency(input: CheckConsistencyInput): Promise<string[]>;
}
