// Pure logic for checklist template maintenance (item edit/delete/reorder, template lifecycle,
// versioning snapshots). No I/O so it is unit-testable; the server actions in
// template-item-actions.ts / template-actions.ts call these around their queries.

export const MAX_ITEM_NUMBER_LENGTH = 20;
export const MAX_ITEM_DESCRIPTION_LENGTH = 500;

/** A template is frozen (items immutable) as soon as any inspection response exists for it. */
export function isTemplateFrozen(responseCount: number | null | undefined): boolean {
  return (responseCount ?? 0) > 0;
}

export const FROZEN_ITEMS_MESSAGE =
  "This checklist already has inspection responses, so its items can no longer be changed.";

export function validateItemFields(input: { itemNumber: string; description: string }): string | null {
  const itemNumber = input.itemNumber.trim();
  const description = input.description.trim();
  if (!itemNumber || !description) return "Item number and description are required.";
  if (itemNumber.length > MAX_ITEM_NUMBER_LENGTH) return `Item number is too long (maximum ${MAX_ITEM_NUMBER_LENGTH} characters).`;
  if (description.length > MAX_ITEM_DESCRIPTION_LENGTH) return `Description is too long (maximum ${MAX_ITEM_DESCRIPTION_LENGTH} characters).`;
  return null;
}

/** Item numbers are unique per template; case-insensitive check, ignoring the item being edited. */
export function isItemNumberTaken(
  items: ReadonlyArray<{ id: string; item_number: string }>,
  itemNumber: string,
  excludeItemId?: string
): boolean {
  const wanted = itemNumber.trim().toLowerCase();
  return items.some((i) => i.id !== excludeItemId && i.item_number.trim().toLowerCase() === wanted);
}

/**
 * Validates a requested order against the template's current items and returns the new
 * sort_order per item (0..n-1). The request must be exactly the current item set, no duplicates.
 */
export function planReorder(
  currentIds: readonly string[],
  requestedIds: readonly string[]
): { ok: true; order: { id: string; sort_order: number }[] } | { ok: false; error: string } {
  if (requestedIds.length !== currentIds.length) return { ok: false, error: "The new order must list every item on the checklist." };
  const requested = new Set(requestedIds);
  if (requested.size !== requestedIds.length) return { ok: false, error: "The new order lists an item more than once." };
  for (const id of currentIds) {
    if (!requested.has(id)) return { ok: false, error: "The new order does not match the checklist's items. Refresh and try again." };
  }
  return { ok: true, order: requestedIds.map((id, sort_order) => ({ id, sort_order })) };
}

/** Moves one id a single step up or down; returns the same order when it is already at the edge. */
export function moveItem(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const next = [...ids];
  const from = next.indexOf(id);
  if (from === -1) return next;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Delete is only meaningful for a template nobody ran an inspection against; otherwise archive. */
export function templateDeleteDecision(inspectionRecordCount: number): "delete" | "archive_only" {
  return inspectionRecordCount > 0 ? "archive_only" : "delete";
}

export interface SnapshotItemInput {
  id: string;
  item_number: string;
  description: string;
  is_mandatory: boolean;
  sort_order: number;
  acceptance_criteria?: string | null;
  evidence_type?: string | null;
}

export interface ChecklistItemSnapshotEntry {
  id: string;
  item_number: string;
  description: string;
  is_mandatory: boolean;
  sort_order: number;
  acceptance_criteria: string | null;
  evidence_type: string | null;
}

/** Frozen copy of a template's items, ordered by sort_order then item_number, stored on the record at start. */
export function buildItemsSnapshot(items: readonly SnapshotItemInput[]): ChecklistItemSnapshotEntry[] {
  return [...items]
    .sort((a, b) => a.sort_order - b.sort_order || a.item_number.localeCompare(b.item_number, undefined, { numeric: true }))
    .map((i) => ({
      id: i.id,
      item_number: i.item_number,
      description: i.description,
      is_mandatory: i.is_mandatory,
      sort_order: i.sort_order,
      acceptance_criteria: i.acceptance_criteria ?? null,
      evidence_type: i.evidence_type ?? null,
    }));
}

/** True when the live template has moved on from the version an inspection was started against. */
export function isSnapshotStale(recordVersion: number | null | undefined, templateVersion: number | null | undefined): boolean {
  if (recordVersion == null || templateVersion == null) return false;
  return recordVersion !== templateVersion;
}

/** Next version number after a content change; tolerant of a missing/invalid current value. */
export function nextTemplateVersion(current: number | null | undefined): number {
  return Number.isInteger(current) && (current as number) >= 1 ? (current as number) + 1 : 2;
}

/** Name/number for a duplicated template. */
export function duplicateTemplateName(name: string): string {
  const trimmed = name.trim();
  return /\(copy\)$/i.test(trimmed) ? trimmed : `${trimmed} (copy)`;
}
