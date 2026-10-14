// Who is on a project party, for display only: the party's contact_name, its linked login and its
// team members (project_party_members). Pure helpers; the page decides what the viewer can read and
// passes in only those names, so an unreadable name simply falls back to the party name alone.

export interface PartyContactInput {
  contactName?: string | null;
  linkedUserName?: string | null;
  memberNames?: (string | null | undefined)[];
}

/** Distinct, non-empty person names (case-insensitive de-dupe), contact first, then login, then members. */
export function partyContactNames(input: PartyContactInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [input.contactName, input.linkedUserName, ...(input.memberNames ?? [])]) {
    const name = (raw ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** "Party (Ann, Bob)" or just "Party" when no names are known; long lists collapse to "Ann, Bob +2". */
export function partyWithPeople(partyName: string, names: string[], max = 3): string {
  if (names.length === 0) return partyName;
  const shown = names.slice(0, max).join(", ");
  const extra = names.length > max ? ` +${names.length - max}` : "";
  return `${partyName} (${shown}${extra})`;
}
