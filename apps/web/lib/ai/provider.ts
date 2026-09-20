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
  /** The document's own controlled number (e.g. "25045-C2000-20-3GS-E-049"), when the vault record
   *  has one — this is what a generated activity's reference_spec should actually cite, rather than
   *  the AI having to re-derive it from wherever the document happens to restate its own number
   *  inside its body text (real documents don't always do this consistently). Null for an
   *  uncontrolled/one-off upload with no document_reference. */
  documentReference: string | null;
  /** The document's revision (e.g. "00", "B"), when known — cited alongside documentReference so a
   *  generated ITP references the exact revision the draft was actually grounded in. */
  revision: string | null;
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

export interface DraftReportNarrativeInput {
  /** "inspection" (a general Inspection Report) or "fat" (a FAT/standalone assignment report). */
  reportType: "inspection" | "fat";
  subject: string;
  projectName: string;
  /** e.g. "pass" | "fail" | "partial" for an inspection; "pass" | "conditional_pass" | "fail" for a FAT. */
  outcome: string | null;
  /** Plain facts only — item counts, punch items, etc. — the model may summarise but not invent beyond these. */
  facts: string[];
}

export interface DraftNcrDescriptionResult {
  description: string;
  requirementNotMet: string;
}

export interface SuggestRootCauseInput {
  description: string;
  requirementNotMet: string | null;
  severity: string;
}

export interface CheckConsistencyInput {
  acceptanceCriteria: string;
  responses: { itemDescription: string; result: "yes" | "no" | "na"; comment: string | null }[];
}

export interface SuggestStandaloneMeasurementsInput {
  /** "fat" | "witness_inspection" | "specific_test" | "pre_shipment". */
  assignmentType: string;
  equipmentDescription: string;
  manufacturer: string | null;
  model: string | null;
  standardReference: string | null;
}

export interface StandaloneMeasurementSuggestion {
  description: string;
  /** Blank when a real numeric value can't be grounded in the given standard/equipment description. */
  nominal: string;
  tolerance: string;
  unit: string;
}

export interface ExtractRegisterInput {
  /** Raw extracted text from one or more vault documents (certificates, WPQs, submittals/CoCs), or
   *  free-typed text pasted directly — whatever the document controller has on hand. */
  sourceText: string;
}

export interface ExtractedCalibrationRow {
  instrumentName: string;
  /** Null when the source text doesn't state it — an extraction must never invent a certificate
   *  number, date, or any other field it can't actually find. */
  certNumber: string | null;
  calDate: string | null;
  dueDate: string | null;
}

export interface ExtractedWelderRow {
  welderIdentifier: string;
  /** Process + position combined (e.g. "GTAW/SMAW, position 6G"), since the register only has one
   *  free-text field for this — see welder_qualification_register.qualified_wps. Null if neither is
   *  stated. */
  qualifiedWps: string | null;
  /** Qualified range AND continuity status combined into one field, same reasoning — null (never a
   *  guessed range) when the source text doesn't state a verified range or continuity record. */
  qualifiedRanges: string | null;
  expiryDate: string | null;
}

export interface ExtractedMaterialRow {
  materialDescription: string;
  submittalReference: string | null;
  heatNumber: string | null;
  batchNumber: string | null;
  poReference: string | null;
  certificateReference: string | null;
}

export interface AiProvider {
  generateItpDraft(input: GenerateItpDraftInput): Promise<ItpDraftResult>;
  generateChecklistItems(input: GenerateChecklistItemsInput): Promise<ChecklistItemDraft[]>;
  draftNcrDescription(input: DraftNcrDescriptionInput): Promise<DraftNcrDescriptionResult>;
  checkConsistency(input: CheckConsistencyInput): Promise<string[]>;
  draftReportNarrative(input: DraftReportNarrativeInput): Promise<string>;
  suggestRootCause(input: SuggestRootCauseInput): Promise<string>;
  suggestStandaloneMeasurements(input: SuggestStandaloneMeasurementsInput): Promise<StandaloneMeasurementSuggestion[]>;
  /** Reqs from the client's register sample pack: extract calibration/welder/material register rows
   *  from raw document text, returning null for any field the source doesn't actually state — never
   *  inferring a certificate number, date, qualification range, heat number, or release status. None
   *  of these three ever write to the database; the document controller reviews and edits every row
   *  before the existing manual "add row" action persists it. */
  extractCalibrationRows(input: ExtractRegisterInput): Promise<ExtractedCalibrationRow[]>;
  extractWelderRows(input: ExtractRegisterInput): Promise<ExtractedWelderRow[]>;
  extractMaterialRows(input: ExtractRegisterInput): Promise<ExtractedMaterialRow[]>;
}
