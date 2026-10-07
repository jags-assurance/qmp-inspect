// Turns whatever a barcode / QR scan returns into a register or checklist search code. Pure and
// unit-tested. Stickers may carry a plain tag ("CAL-2291"), a deep link produced by this app
// (/inspect/start-work/find?code=...), or some other URL ending in the tag.

const MAX_CODE_LENGTH = 80;

export function extractScanCode(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      for (const key of ["code", "tag", "q", "id"]) {
        const v = url.searchParams.get(key);
        if (v && v.trim()) return clean(v);
      }
      const last = url.pathname.split("/").filter(Boolean).pop();
      if (last) return clean(decodeURIComponent(last));
    } catch {
      // fall through to the plain text path
    }
  }
  // GS1-style or multi-line payloads: first non-empty line only.
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? text;
  return clean(firstLine);
}

function clean(v: string): string {
  // Control characters out, whitespace collapsed, bounded.
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_CODE_LENGTH);
}
