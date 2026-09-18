// Pure formatting logic shared between the server-side number generator (generate.ts) and the
// numbering settings page's live sample preview (numbering-config-row.tsx) — pulled out so the
// preview shown while configuring a format is guaranteed to match what generateDocumentNumber
// actually produces, rather than a second hand-written approximation drifting out of sync with it.

export function formatDocumentNumber(
  parts: { clientCode: string; originatorCode: string; docType: string; seq: number },
  config: { separator: string; sequencePadding: number; includeYear: boolean }
): string {
  const seq = String(parts.seq).padStart(config.sequencePadding, "0");
  const segments = [parts.clientCode, parts.originatorCode, parts.docType.toUpperCase(), seq];
  if (config.includeYear) segments.splice(3, 0, String(new Date().getFullYear()));
  return segments.filter(Boolean).join(config.separator);
}
