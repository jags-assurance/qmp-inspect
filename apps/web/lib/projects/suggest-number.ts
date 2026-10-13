/**
 * Suggests the next project number for a client organisation, e.g. "Test Harbour Power" in 2026 with no
 * earlier projects -> "THP-2026-001". The suggestion only pre-fills the field; the user can overtype it.
 */

/** 3+ words: initials of the first three ("Test Harbour Power" -> THP). 1-2 words: first three letters of the first word ("Meridian Energy" -> MER). */
export function organisationPrefix(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "PRJ";
  const letters =
    words.length >= 3 ? words.slice(0, 3).map((w) => w[0]).join("") : words[0].slice(0, 3);
  return letters.toUpperCase();
}

/** Next "<PREFIX>-<year>-<seq>" given the project numbers that already exist; the sequence continues from the highest used, never reusing a gap. */
export function suggestProjectNumber(orgName: string, year: number, existingNumbers: string[]): string {
  const prefix = organisationPrefix(orgName);
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`, "i");
  let highest = 0;
  for (const number of existingNumbers) {
    const match = pattern.exec(number.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}-${year}-${String(highest + 1).padStart(3, "0")}`;
}
