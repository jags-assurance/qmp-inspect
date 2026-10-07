// Pure presentation rules for the checklist template / inspection review UI. No I/O so they are
// unit-testable; the components decide what to show / disable from these.

import { FROZEN_ITEMS_MESSAGE, isSnapshotStale, isTemplateFrozen, templateDeleteDecision } from "./template-logic";
import type { ReviewStatus } from "./review-logic";

export const ARCHIVED_ITEMS_MESSAGE = "This checklist is archived. Restore it before changing its items.";

/** Why the items of a template cannot be edited / deleted / reordered right now, or null when they can. */
export function itemEditBlockReason(input: { archived: boolean; responseCount: number | null | undefined }): string | null {
  if (input.archived) return ARCHIVED_ITEMS_MESSAGE;
  if (isTemplateFrozen(input.responseCount)) return FROZEN_ITEMS_MESSAGE;
  return null;
}

/** Why a template cannot be hard-deleted (it has inspection records and must be archived), or null. */
export function templateDeleteBlockReason(inspectionRecordCount: number): string | null {
  return templateDeleteDecision(inspectionRecordCount) === "archive_only"
    ? "This checklist has inspection records, so it cannot be deleted. Archive it instead."
    : null;
}

export type ArchiveFilter = "active" | "archived";

export function parseArchiveFilter(raw: string | null | undefined): ArchiveFilter {
  return raw === "archived" || raw === "1" ? "archived" : "active";
}

/** Keeps archived templates out of normal views; the "archived" filter shows only archived ones. */
export function filterByArchive<T extends { id: string }>(
  rows: readonly T[],
  archivedIds: ReadonlySet<string>,
  filter: ArchiveFilter
): T[] {
  return rows.filter((r) => (filter === "archived" ? archivedIds.has(r.id) : !archivedIds.has(r.id)));
}

/** Warning copy when the template changed after the inspection started, else null. */
export function staleSnapshotWarning(recordVersion: number | null | undefined, templateVersion: number | null | undefined): string | null {
  if (!isSnapshotStale(recordVersion, templateVersion)) return null;
  return `This inspection was started on checklist version ${recordVersion}; the checklist has since been changed (now version ${templateVersion}). Compare the responses below with the current checklist before relying on them.`;
}

export function reviewStatusLabel(status: ReviewStatus | null | undefined): { label: string; tone: "success" | "danger" | "neutral" } {
  if (status === "approved") return { label: "Approved", tone: "success" };
  if (status === "rejected") return { label: "Rejected", tone: "danger" };
  return { label: "Not reviewed", tone: "neutral" };
}

export interface PreviousResponse {
  checklist_item_id: string;
  item_number: string | null;
  description: string | null;
  result: string;
  comment: string | null;
}

/** Defensively reads the previous_responses jsonb of an amendment (may be null / malformed). */
export function parsePreviousResponses(raw: unknown): PreviousResponse[] {
  if (!Array.isArray(raw)) return [];
  const out: PreviousResponse[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.checklist_item_id !== "string" || typeof o.result !== "string") continue;
    out.push({
      checklist_item_id: o.checklist_item_id,
      item_number: typeof o.item_number === "string" ? o.item_number : null,
      description: typeof o.description === "string" ? o.description : null,
      result: o.result,
      comment: typeof o.comment === "string" ? o.comment : null,
    });
  }
  return out;
}
