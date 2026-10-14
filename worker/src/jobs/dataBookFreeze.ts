// Pure policy for the frozen, issued Data Book (audit M2). Once a handover certificate stores
// rendered_book_sha256 the certified PDF is never replaced: a re-render goes to a separate path, is hashed
// and compared, and any mismatch is recorded as an audit event instead of replacing anything.

export type IssuedRenderAction =
  /** Not issued: ordinary draft/compiled render. */
  | "render_normal"
  /** Issued, nothing filed yet: this is the first render, certify it (store path + hash + snapshot). */
  | "render_first_certified"
  /** Issued and a filed copy exists: return it (backfill the hash from its bytes if the certificate has none). */
  | "return_filed"
  /** Issued + forced: render a reprint to a new path, never filed, compared against the certified state. */
  | "reprint";

export function decideIssuedRender(input: {
  status: string;
  force: boolean;
  filedPath: string | null;
}): IssuedRenderAction {
  if (input.status !== "issued") return "render_normal";
  if (input.force) return "reprint";
  return input.filedPath ? "return_filed" : "render_first_certified";
}

export type HashComparison = "no_certified_hash" | "match" | "mismatch";

export function compareToCertified(certifiedSha: string | null | undefined, candidateSha: string): HashComparison {
  if (!certifiedSha) return "no_certified_hash";
  return certifiedSha.toLowerCase() === candidateSha.toLowerCase() ? "match" : "mismatch";
}

/** The certified record may only be written while it is still empty. */
export function mayRecordCertifiedHash(existingSha: string | null | undefined): boolean {
  return !existingSha;
}

/** Reprints carry a "REPRINT" footer, so the PDF bytes differ by design; the content hash is the meaningful check. */
export function describeReprintCheck(input: {
  certifiedSha: string | null;
  reprintSha: string;
  snapshotContentHash: string | null;
  reprintContentHash: string;
}): { pdf: HashComparison; content: HashComparison; mismatch: boolean; note: string } {
  const pdf = compareToCertified(input.certifiedSha, input.reprintSha);
  const content = compareToCertified(input.snapshotContentHash, input.reprintContentHash);
  const mismatch = content === "mismatch";
  const note = mismatch
    ? "Re-render of an issued Data Book differs from the content frozen at issue (registers/records changed since). The certified PDF was NOT replaced."
    : content === "match"
      ? "Re-render content matches the content frozen at issue. The certified PDF was NOT replaced."
      : "Re-render saved separately; no issue-time content snapshot exists to compare. The certified PDF was NOT replaced.";
  return { pdf, content, mismatch, note };
}
