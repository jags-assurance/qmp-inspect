// S6-18: pure rules for the organisation retention setting and the review of flagged documents.
// Mirrors worker/src/retentionPolicy.ts (the worker cannot import from the web app). Retention only
// FLAGS documents for human review; nothing here deletes or changes a document.

export const MIN_RETENTION_YEARS = 1;
export const MAX_RETENTION_YEARS = 100;
export const MAX_REVIEW_NOTE_LENGTH = 2000;

export const RETENTION_SETTINGS_TABLE = "org_retention_settings";
export const RETENTION_FLAGS_TABLE = "vault_retention_flags";

export type RetentionReviewOutcome = "keep" | "dispose_approved";

export interface RetentionFlagRow {
  document_id: string;
  organization_id: string;
  project_id: string;
  retention_years: number;
  reference_date: string;
  due_on: string;
  flagged_at: string;
  review_outcome: RetentionReviewOutcome | null;
  review_note: string | null;
  reviewed_at: string | null;
  disposed_at?: string | null;
  vault_documents: { title: string; document_number: string | null; revision: string; status: string; storage_path?: string | null } | null;
  users: { full_name: string } | null;
}

export type ParsedRetention = { ok: true; years: number } | { ok: false; error: string };

/** Whole years from 1 to 100, from raw form text. */
export function parseRetentionYears(raw: string | null | undefined): ParsedRetention {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return { ok: false, error: "Enter the retention period as a whole number of years." };
  const years = Number(text);
  if (years < MIN_RETENTION_YEARS || years > MAX_RETENTION_YEARS) {
    return { ok: false, error: `The retention period must be between ${MIN_RETENTION_YEARS} and ${MAX_RETENTION_YEARS} years.` };
  }
  return { ok: true, years };
}

export type ParsedReview = { ok: true; outcome: RetentionReviewOutcome; note: string | null } | { ok: false; error: string };

/** A note is required to approve disposal; keeping a document needs none. */
export function parseRetentionReview(outcomeRaw: string | null | undefined, noteRaw: string | null | undefined): ParsedReview {
  const outcome = outcomeRaw === "keep" || outcomeRaw === "dispose_approved" ? outcomeRaw : null;
  if (!outcome) return { ok: false, error: "Choose a decision." };
  const note = (noteRaw ?? "").trim();
  if (note.length > MAX_REVIEW_NOTE_LENGTH) return { ok: false, error: `The note must be ${MAX_REVIEW_NOTE_LENGTH} characters or fewer.` };
  if (outcome === "dispose_approved" && note.length < 5) return { ok: false, error: "Add a note (at least 5 characters) saying who approved disposal and why." };
  return { ok: true, outcome, note: note || null };
}

export const REVIEW_OUTCOME_LABEL: Record<RetentionReviewOutcome, string> = {
  keep: "Kept",
  dispose_approved: "Disposal approved",
};

/** Maps a review_retention_flag() error to a user-facing message. */
export function reviewErrorMessage(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("admin")) return "Only a JAGS Admin can review a retention flag.";
  if (m.includes("not flagged")) return "This document is not flagged for retention review.";
  if (m.includes("note")) return "A note is required when approving disposal.";
  if (m.includes("access")) return "You do not have access to this project.";
  return "Could not record the review. Please try again.";
}

/** Whole days between an ISO due date and now (positive once it has passed); used for "overdue by". */
export function daysPastDue(dueOn: string, now: number): number {
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  if (!Number.isFinite(due)) return 0;
  return Math.max(0, Math.floor((now - due) / 86_400_000));
}

/** The word an Admin must type before a stored file is removed. */
export const DISPOSE_CONFIRMATION_WORD = "DISPOSE";

export function isDisposalConfirmed(input: string | null | undefined): boolean {
  return (input ?? "").trim() === DISPOSE_CONFIRMATION_WORD;
}

/**
 * Where a vault row's file lives: worker-filed documents are stored as "generated-documents:<path>",
 * everything else is a bare path in inspection-evidence. Returns null for an unusable path.
 */
export function resolveVaultStorageLocation(storagePath: string | null | undefined): { bucket: string; path: string } | null {
  const raw = (storagePath ?? "").trim();
  if (!raw || raw.includes("..")) return null;
  const m = /^([a-z0-9_-]+):(.+)$/i.exec(raw);
  if (m) return m[1] === "generated-documents" ? { bucket: m[1], path: m[2] } : null;
  return { bucket: "inspection-evidence", path: raw };
}

export function disposeErrorMessage(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("admin")) return "Only a JAGS Admin can mark a document disposed.";
  if (m.includes("not flagged")) return "This document is not flagged for retention review.";
  if (m.includes("not been approved")) return "Disposal has not been approved for this document.";
  if (m.includes("access")) return "You do not have access to this project.";
  return "Could not record the disposal. Please try again.";
}
