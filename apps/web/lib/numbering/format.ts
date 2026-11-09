// Pure formatting logic shared between the server-side number generator (generate.ts) and the
// numbering settings page's live sample preview (numbering-config-row.tsx) — pulled out so the
// preview shown while configuring a format is guaranteed to match what generateDocumentNumber
// actually produces, rather than a second hand-written approximation drifting out of sync with it.

export function formatDocumentNumber(
  parts: {
    clientCode: string;
    originatorCode: string;
    docType: string;
    seq: number;
    /** R104: this document's discipline code (master_disciplines.code), when one is resolvable at
     *  generation time. Only ever inserted when `config.includeDiscipline` is true AND this is
     *  non-null/non-empty — a config wanting the segment but with nothing resolvable simply omits
     *  it, never a blank placeholder (this app's no-fabricated-data rule). */
    disciplineCode?: string | null;
  },
  config: { separator: string; sequencePadding: number; includeYear: boolean; includeDiscipline?: boolean }
): string {
  const seq = String(parts.seq).padStart(config.sequencePadding, "0");
  // Fixed order, not configurable: client, originator, doc type, [discipline], [year], sequence —
  // discipline lands "right after the doc-type segment" as specified, ahead of the optional year.
  const segments = [parts.clientCode, parts.originatorCode, parts.docType.toUpperCase().replace(/_/g, "-")];
  if (config.includeDiscipline && parts.disciplineCode) segments.push(parts.disciplineCode.toUpperCase());
  if (config.includeYear) segments.push(String(new Date().getFullYear()));
  segments.push(seq);
  return segments.filter(Boolean).join(config.separator);
}
