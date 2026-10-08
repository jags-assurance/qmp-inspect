/**
 * Deterministic, non-AI starter checklist for an ITP activity. Used when an ITP is approved without
 * paid AI / org AI consent (or when AI could not draft one), so approval still leaves every
 * evidence-type-1 activity with a field-usable checklist. One item per acceptance-criterion line
 * (or, failing that, per activity description); staff are expected to refine it.
 */
export const STARTER_NAME_SUFFIX = " (auto-generated starter)";
const MAX_ITEMS = 12;
const MAX_LEN = 500;

export interface StarterSource {
  activity: string | null;
  acceptance_criteria: string | null;
  reference_spec?: string | null;
}

export function isStarterChecklistName(name: string): boolean {
  return name.endsWith(STARTER_NAME_SUFFIX);
}

export function starterChecklistName(activity: string | null): string {
  return `${(activity ?? "Activity").trim().slice(0, 200)}${STARTER_NAME_SUFFIX}`;
}

export function buildStarterItems(src: StarterSource): { item_number: string; description: string; is_mandatory: boolean; sort_order: number }[] {
  const clip = (s: string) => s.trim().slice(0, MAX_LEN);
  const criteria = (src.acceptance_criteria ?? "")
    .split(/\r?\n|;/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""))
    .map(clip)
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  const lines = criteria.length > 0 ? criteria : [clip(src.activity ?? "") || "Confirm the activity meets the specification"];
  return lines.map((description, i) => ({ item_number: String(i + 1), description, is_mandatory: true, sort_order: i }));
}
