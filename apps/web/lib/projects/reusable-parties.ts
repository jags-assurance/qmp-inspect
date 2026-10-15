// Parties (companies) already used on an organisation's OTHER projects, offered for reuse when adding a
// party to a new project, so the same subcontractor is not retyped (and misspelled) each time.
// Pure so it unit-tests directly; the server action feeds it rows.

export interface PartyRow {
  project_id: string;
  party_type: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
}

export interface ReusableParty {
  partyType: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  /** On how many of the organisation's other projects this party already appears. */
  projectCount: number;
}

const key = (type: string, name: string) => `${type}|${name.trim().toLowerCase()}`;

/**
 * One entry per (party type, name), most-used first then A-Z. A party already on `thisProjectId` is left out
 * (it can't be added twice). Contact details come from the most recent row that has them (rows are expected
 * newest first).
 */
export function buildReusableParties(rows: PartyRow[], thisProjectId: string): ReusableParty[] {
  const onThisProject = new Set(rows.filter((r) => r.project_id === thisProjectId).map((r) => key(r.party_type, r.name)));
  const byKey = new Map<string, ReusableParty & { projects: Set<string> }>();
  for (const r of rows) {
    if (r.project_id === thisProjectId || !r.name.trim()) continue;
    const k = key(r.party_type, r.name);
    if (onThisProject.has(k)) continue;
    const entry = byKey.get(k) ?? { partyType: r.party_type, name: r.name.trim(), contactName: null, contactEmail: null, projectCount: 0, projects: new Set<string>() };
    entry.projects.add(r.project_id);
    entry.projectCount = entry.projects.size;
    if (!entry.contactName && r.contact_name) entry.contactName = r.contact_name;
    if (!entry.contactEmail && r.contact_email) entry.contactEmail = r.contact_email;
    byKey.set(k, entry);
  }
  return [...byKey.values()]
    .map(({ projects: _projects, ...p }) => p)
    .sort((a, b) => b.projectCount - a.projectCount || a.name.localeCompare(b.name));
}
