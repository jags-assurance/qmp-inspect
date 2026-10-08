// Pure rules for inspection completion evidence + signature validation, kept free of Supabase so they
// are unit-testable (see lib/checklists/__tests__/evidence-rules.test.ts).
import type { ChecklistResponseResult } from "./db-types";

export const SIGNATURE_MAX_CHARS = 700_000; // ~500 KB of decoded PNG/JPEG
export const MIN_NA_COMMENT_LENGTH = 10;

/** A signature must be a base64 PNG/JPEG data URL under the size cap. Returns an error or null. */
export function validateSignatureDataUrl(value: string, label = "signature"): string | null {
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value)) {
    return `The ${label} must be a PNG or JPEG image drawn on the signature pad.`;
  }
  if (value.length > SIGNATURE_MAX_CHARS) return `The ${label} image is too large.`;
  return null;
}

export interface EvidenceDocLink {
  checklist_item_id: string | null;
  status: string | null;
  uploaded_by: string | null;
  folder_key: string | null;
}

/** Only approved vault docs count; a for_review doc counts only when the signer uploaded it into Checklists & Forms. Rejected never. */
export function isCountableEvidenceDoc(doc: EvidenceDocLink, signerId: string | null): boolean {
  if (doc.status === "approved") return true;
  return doc.status === "for_review" && !!signerId && doc.uploaded_by === signerId && doc.folder_key === "checklists_forms";
}

export interface EvidenceItem {
  id: string;
  item_number: string;
  is_mandatory: boolean;
}
export interface EvidenceResponse {
  checklist_item_id: string;
  result: ChecklistResponseResult;
  comment: string | null;
}

/** Item numbers where N/A on a mandatory item has no >=10 char comment. */
export function mandatoryNaWithoutComment(items: EvidenceItem[], responses: EvidenceResponse[]): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return responses
    .filter((r) => r.result === "na" && byId.get(r.checklist_item_id)?.is_mandatory && (r.comment ?? "").trim().length < MIN_NA_COMMENT_LENGTH)
    .map((r) => byId.get(r.checklist_item_id)!.item_number);
}

/** Item numbers that are 'no' or mandatory (and not N/A) and have neither an item photo nor an item document. */
export function itemsMissingEvidence(
  items: EvidenceItem[],
  responses: EvidenceResponse[],
  itemIdsWithPhoto: Set<string>,
  itemIdsWithDoc: Set<string>
): string[] {
  const resById = new Map(responses.map((r) => [r.checklist_item_id, r]));
  const out: string[] = [];
  for (const item of items) {
    const r = resById.get(item.id);
    if (!r || r.result === "na") continue;
    const needs = r.result === "no" || item.is_mandatory;
    if (needs && !itemIdsWithPhoto.has(item.id) && !itemIdsWithDoc.has(item.id)) out.push(item.item_number);
  }
  return out;
}

/** True when a partial result came from a mandatory item answered N/A (never issuable / completable that way). */
export function hasMandatoryNa(items: EvidenceItem[], responses: EvidenceResponse[]): boolean {
  const byId = new Map(items.map((i) => [i.id, i]));
  return responses.some((r) => r.result === "na" && byId.get(r.checklist_item_id)?.is_mandatory);
}

/**
 * What evidence this item needs given its current answer, for showing it BEFORE completion (the
 * completion check uses the same rules via itemsMissingEvidence / mandatoryNaWithoutComment).
 * Returns null when nothing is required.
 */
export function evidenceRequirementHint(
  isMandatory: boolean,
  result: ChecklistResponseResult | null,
  hasPhotoOrDoc: boolean
): { text: string; met: boolean } | null {
  if (!result) return null;
  if (result === "na") {
    return isMandatory
      ? { text: `Mandatory item: N/A needs a comment of at least ${MIN_NA_COMMENT_LENGTH} characters, and the inspection cannot pass with it.`, met: false }
      : null;
  }
  if (result === "no" || isMandatory) {
    return {
      text: hasPhotoOrDoc ? "Evidence attached." : "Evidence required: attach a photo or a document to this item before completing.",
      met: hasPhotoOrDoc,
    };
  }
  return null;
}
