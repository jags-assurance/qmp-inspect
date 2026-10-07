import type { ItpRevisionSnapshotItem, ItpRevisionSnapshotSection } from "./revision-types";

/** S2-18: pure comparison of two frozen ITP revision snapshots (older -> newer). */

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface ItemChange {
  id: string;
  itemNumber: string;
  activity: string;
  changes: FieldChange[];
}

export interface RevisionDiff {
  addedItems: { id: string; itemNumber: string; activity: string; section: string }[];
  removedItems: { id: string; itemNumber: string; activity: string; section: string }[];
  changedItems: ItemChange[];
  addedSections: { number: number; title: string }[];
  removedSections: { number: number; title: string }[];
  renamedSections: { number: number; before: string; after: string }[];
  headerChanges: FieldChange[];
  isEmpty: boolean;
}

export interface DiffableRevision {
  title?: string | null;
  scope?: string | null;
  applicable_standard?: string | null;
  sections_snapshot: ItpRevisionSnapshotSection[];
}

const EVIDENCE_LABEL: Record<number, string> = { 1: "Checklist", 2: "Document upload", 3: "Measurement" };

const ITEM_FIELDS: { key: keyof ItpRevisionSnapshotItem; label: string }[] = [
  { key: "item_number", label: "Number" },
  { key: "activity", label: "Activity" },
  { key: "acceptance_criteria", label: "Acceptance criteria" },
  { key: "reference_spec", label: "Reference" },
  { key: "method", label: "Method" },
  { key: "frequency", label: "Frequency" },
  { key: "evidence_type", label: "Evidence" },
  { key: "notice_hours_override", label: "Notice hours" },
];

function show(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (key === "evidence_type" && typeof value === "number") return EVIDENCE_LABEL[value] ?? String(value);
  return String(value);
}

function levelsText(item: ItpRevisionSnapshotItem): string {
  const parts = (item.interventions ?? []).map((i) => `${i.party_name || "Party"} ${i.intervention}`).sort();
  return parts.length ? parts.join(", ") : "-";
}

function flatten(sections: ItpRevisionSnapshotSection[]): Map<string, { item: ItpRevisionSnapshotItem; section: string }> {
  const m = new Map<string, { item: ItpRevisionSnapshotItem; section: string }>();
  for (const s of sections) for (const item of s.items ?? []) m.set(item.id, { item, section: `${s.section_number}. ${s.title}` });
  return m;
}

export function diffRevisions(older: DiffableRevision, newer: DiffableRevision): RevisionDiff {
  const oldSections = Array.isArray(older.sections_snapshot) ? older.sections_snapshot : [];
  const newSections = Array.isArray(newer.sections_snapshot) ? newer.sections_snapshot : [];

  const headerChanges: FieldChange[] = [];
  for (const [field, label] of [
    ["title", "Title"],
    ["scope", "Scope"],
    ["applicable_standard", "Applicable standard"],
  ] as const) {
    const b = older[field] ?? null;
    const a = newer[field] ?? null;
    if (b !== a) headerChanges.push({ field, label, before: show(field, b), after: show(field, a) });
  }

  const oldById = new Map(oldSections.map((s) => [s.id, s]));
  const newById = new Map(newSections.map((s) => [s.id, s]));
  const addedSections = newSections.filter((s) => !oldById.has(s.id)).map((s) => ({ number: s.section_number, title: s.title }));
  const removedSections = oldSections.filter((s) => !newById.has(s.id)).map((s) => ({ number: s.section_number, title: s.title }));
  const renamedSections = newSections
    .filter((s) => oldById.has(s.id) && oldById.get(s.id)!.title !== s.title)
    .map((s) => ({ number: s.section_number, before: oldById.get(s.id)!.title, after: s.title }));

  const oldItems = flatten(oldSections);
  const newItems = flatten(newSections);
  const addedItems = [...newItems.values()]
    .filter(({ item }) => !oldItems.has(item.id))
    .map(({ item, section }) => ({ id: item.id, itemNumber: item.item_number, activity: item.activity, section }));
  const removedItems = [...oldItems.values()]
    .filter(({ item }) => !newItems.has(item.id))
    .map(({ item, section }) => ({ id: item.id, itemNumber: item.item_number, activity: item.activity, section }));

  const changedItems: ItemChange[] = [];
  for (const { item } of newItems.values()) {
    const prev = oldItems.get(item.id)?.item;
    if (!prev) continue;
    const changes: FieldChange[] = [];
    for (const { key, label } of ITEM_FIELDS) {
      const b = prev[key] ?? null;
      const a = item[key] ?? null;
      if (b !== a) changes.push({ field: key, label, before: show(key, b), after: show(key, a) });
    }
    // Older snapshots have no intervention data: only compare when both sides recorded it.
    if (item.interventions !== undefined && prev.interventions !== undefined && levelsText(item) !== levelsText(prev)) {
      changes.push({ field: "interventions", label: "Sign-off levels", before: levelsText(prev), after: levelsText(item) });
    }
    if (changes.length) changedItems.push({ id: item.id, itemNumber: item.item_number, activity: item.activity, changes });
  }

  const isEmpty =
    !headerChanges.length &&
    !addedSections.length &&
    !removedSections.length &&
    !renamedSections.length &&
    !addedItems.length &&
    !removedItems.length &&
    !changedItems.length;
  return { addedItems, removedItems, changedItems, addedSections, removedSections, renamedSections, headerChanges, isEmpty };
}
