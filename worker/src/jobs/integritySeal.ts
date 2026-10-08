import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PDF integrity seal. A SHA-256 over the exact PDF bytes is stored on the document row after rendering;
 * the public /verify page checks an uploaded file against it. A PDF cannot contain its own final hash, so
 * the footer prints a short CONTENT fingerprint (the hash of the source data) and the bytes hash lives in
 * the database. This is tamper evidence, not a cryptographic signature: nothing is signed with a certificate.
 */

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** "ABCD-1234-EF56-7890": the first 16 hex characters, upper-case, in groups of four. Empty for a non-hash. */
export function shortSeal(hex: string | null | undefined): string {
  if (!hex || !/^[0-9a-f]{16,}$/i.test(hex)) return "";
  return hex.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, "$1-");
}

/** Footer fragment for the Puppeteer footerTemplate. Empty string when there is no hash. */
export function sealFooterSpan(contentHash: string | null | undefined): string {
  const short = shortSeal(contentHash);
  return short ? `<span>Content seal ${short}</span>` : "";
}

export type SealKind = "certificate" | "irn";

/**
 * Appends the SHA-256 of the rendered PDF to the document row. Best-effort: the column and function come
 * from a migration, so an error (not applied yet) is logged and never fails the render.
 */
export async function recordRenderedPdfHash(supabase: SupabaseClient, kind: SealKind, id: string, pdf: Buffer | Uint8Array): Promise<string> {
  const sha = sha256Hex(pdf);
  try {
    const { error } = await supabase.rpc("record_rendered_pdf_sha256" as never, { p_kind: kind, p_id: id, p_sha256: sha } as never);
    if (error) console.warn(`[integritySeal] Could not record the PDF hash for ${kind} ${id}: ${error.message}`);
  } catch (err) {
    console.warn(`[integritySeal] Could not record the PDF hash for ${kind} ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return sha;
}
