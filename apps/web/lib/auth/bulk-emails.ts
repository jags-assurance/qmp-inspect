/** S1-16: parsing the pasted list of emails for bulk account deactivation / reactivation. */

export const MAX_BULK_ACCOUNTS = 50;

// Deliberately simple: the real check is whether an account with that address exists.
const EMAIL = /^[^\s@,;<>()[\]]+@[^\s@,;<>()[\]]+\.[^\s@,;<>()[\]]+$/;

export interface ParsedEmailList {
  /** Valid, lower-cased, de-duplicated addresses in the order given (at most `max`). */
  emails: string[];
  /** Entries that are not email addresses. */
  invalid: string[];
  /** True when more than `max` valid addresses were supplied (nothing should be processed then). */
  truncated: boolean;
}

export function parseEmailList(raw: string, max: number = MAX_BULK_ACCOUNTS): ParsedEmailList {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const piece of raw.split(/[\s,;]+/)) {
    // Allow "Name <a@b.com>" pasted from a mail client: take what is inside the brackets.
    const cleaned = piece.replace(/^<|>$/g, "").trim();
    if (!cleaned) continue;
    if (!EMAIL.test(cleaned)) {
      invalid.push(cleaned);
      continue;
    }
    const lower = cleaned.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    emails.push(lower);
  }
  const truncated = emails.length > max;
  return { emails: truncated ? emails.slice(0, max) : emails, invalid, truncated };
}
