export interface AiConsentHistoryRow {
  id: string;
  organization_id: string;
  consent: boolean;
  changed_at: string;
  users: { full_name: string | null } | null;
}

/** One line of the AI-consent history: what changed, who did it, when (E-09 / B9). */
export function describeConsentChange(row: Pick<AiConsentHistoryRow, "consent" | "changed_at" | "users">): string {
  const who = row.users?.full_name?.trim() || "an unknown user";
  const when = new Date(row.changed_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  return `${row.consent ? "Consent given" : "Consent withdrawn"} by ${who} on ${when} UTC`;
}

/** Groups history rows by organisation, newest first, capped per organisation. */
export function groupConsentHistory(rows: AiConsentHistoryRow[], perOrg = 10): Map<string, AiConsentHistoryRow[]> {
  const out = new Map<string, AiConsentHistoryRow[]>();
  for (const r of [...rows].sort((a, b) => b.changed_at.localeCompare(a.changed_at))) {
    const list = out.get(r.organization_id) ?? [];
    if (list.length < perOrg) list.push(r);
    out.set(r.organization_id, list);
  }
  return out;
}
