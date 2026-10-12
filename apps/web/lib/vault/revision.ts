// Revision numbering for vault uploads that supersede an earlier revision of the same document.

/** The revision after `previous`: 0 -> 1, A -> B, Z -> AA, P1 -> P2, C02 -> C03. Null if it can't tell. */
export function nextRevision(previous: string): string | null {
  const rev = previous.trim();
  if (!rev) return null;
  const trailingNumber = rev.match(/^(.*?)(\d+)$/);
  if (trailingNumber) {
    const [, prefix, digits] = trailingNumber;
    return prefix + String(Number.parseInt(digits, 10) + 1).padStart(digits.length, "0");
  }
  if (/^[A-Za-z]+$/.test(rev)) {
    const upper = rev === rev.toUpperCase();
    const chars = rev.toUpperCase().split("");
    let i = chars.length - 1;
    while (i >= 0 && chars[i] === "Z") chars[i--] = "A";
    if (i < 0) chars.unshift("A");
    else chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    const next = chars.join("");
    return upper ? next : next.toLowerCase();
  }
  return null;
}

/**
 * The revision to store for an upload. `given` is what the form sent; `previous` is the revision it
 * supersedes, if any. A blank revision, or the form's untouched default "0" on a document that already
 * has a revision, means "number it for me" — sending "0" after Rev A used to file Rev 0 *after* Rev A.
 * Anything else the uploader typed is kept as entered (the same revision again is a deliberate replace).
 */
export function resolveUploadRevision(given: string, previous: string | null | undefined): string {
  const typed = given.trim();
  if (previous == null) return typed || "0";
  if (typed && typed !== "0") return typed;
  if (typed === "0" && previous.trim() === "0") return "0";
  return nextRevision(previous) ?? (typed || "0");
}
