import { isRegisterRowActive, type RegisterRowMeta } from "./lifecycle";
import { daysUntil, PERSONNEL_CERTIFICATION_EXPIRING_DAYS } from "./status";

/** S3-09: personnel certificates grouped per person (the named holder, or the party when none is named). */

export interface PersonnelCertRowForGrouping extends RegisterRowMeta {
  id: string;
  expiry_date: string;
  holder_user_id?: string | null;
  project_party_id?: string | null;
  project_parties?: { name: string } | null;
}

export interface PersonnelSummary {
  key: string;
  name: string;
  partyName: string | null;
  total: number;
  expired: number;
  expiringSoon: number;
  valid: number;
  /** Earliest expiry date among the person's not-yet-expired certificates, if any. */
  nextExpiry: string | null;
}

export function groupCertificatesByPerson(
  rows: PersonnelCertRowForGrouping[],
  holderNames: Map<string, string>,
  today?: Date
): PersonnelSummary[] {
  const byKey = new Map<string, PersonnelSummary>();
  for (const row of rows) {
    if (!isRegisterRowActive(row)) continue;
    const partyName = row.project_parties?.name ?? null;
    const holder = row.holder_user_id ?? null;
    const key = holder ? `user:${holder}` : `party:${row.project_party_id ?? partyName ?? "unknown"}`;
    const name = holder ? (holderNames.get(holder) ?? "Named person") : (partyName ?? "Unassigned");
    const entry = byKey.get(key) ?? { key, name, partyName, total: 0, expired: 0, expiringSoon: 0, valid: 0, nextExpiry: null };
    const days = daysUntil(row.expiry_date, today);
    entry.total += 1;
    if (days < 0) entry.expired += 1;
    else {
      if (days <= PERSONNEL_CERTIFICATION_EXPIRING_DAYS) entry.expiringSoon += 1;
      else entry.valid += 1;
      const date = row.expiry_date.slice(0, 10);
      if (!entry.nextExpiry || date < entry.nextExpiry) entry.nextExpiry = date;
    }
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.expired - a.expired || b.expiringSoon - a.expiringSoon || a.name.localeCompare(b.name));
}
