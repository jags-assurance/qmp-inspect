// Pure rules for "pre-fill from the last inspection". Cloned answers are an assist, never evidence:
// only Yes and N/A carry over; a failure (needs its own comment and NCR) and a measured reading (must be
// taken fresh) never do, and nothing overwrites an item already answered on this inspection.

export interface PreviousResponse {
  checklist_item_id: string;
  result: "yes" | "no" | "na";
  comment: string | null;
}

export interface CloneableResponse {
  checklist_item_id: string;
  result: "yes" | "na";
  comment: string | null;
}

export function selectCloneableResponses(
  previous: PreviousResponse[],
  currentItemIds: ReadonlySet<string>,
  alreadyAnsweredIds: ReadonlySet<string>,
  numericItemIds: ReadonlySet<string>
): CloneableResponse[] {
  const out: CloneableResponse[] = [];
  const seen = new Set<string>();
  for (const r of previous) {
    if (seen.has(r.checklist_item_id)) continue;
    seen.add(r.checklist_item_id);
    if (!currentItemIds.has(r.checklist_item_id)) continue;
    if (alreadyAnsweredIds.has(r.checklist_item_id)) continue;
    if (numericItemIds.has(r.checklist_item_id)) continue;
    if (r.result !== "yes" && r.result !== "na") continue;
    // An N/A on a mandatory item needs a real comment; a stored override reason is not copied either.
    out.push({ checklist_item_id: r.checklist_item_id, result: r.result, comment: r.comment?.trim() ? r.comment : null });
  }
  return out;
}
