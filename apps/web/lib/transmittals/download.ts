import { untypedFrom } from "@/lib/supabase/untyped";
import { GENERATED_DOCUMENTS_BUCKET } from "@/lib/reports/types";
import { VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import {
  TRANSMITTAL_DOWNLOAD_TTL_SECONDS,
  TRANSMITTALS_TABLE,
  canTransmit,
  injectDownloadBlock,
  renderDownloadBlock,
  type TransmittalEntityType,
} from "./logic";

// Service-role client (see lib/supabase/service). Typed loosely like the other untyped table handles.
type ServiceClient = Parameters<typeof untypedFrom>[0];

const VAULT_BUCKET = "inspection-evidence";

/**
 * Builds the time-limited (7 day) signed download link and the verify-page link for a transmittal, at
 * SEND time. Only for an approved vault document / issued Data Book; otherwise returns "" (the email
 * then carries only the sign-in link). A storage failure throws so the caller treats the attempt as
 * failed and retries (a stored URL would expire, so every attempt signs afresh). The signed URL is never
 * logged, audited or stored: callers must not include it in any message.
 */
export async function buildTransmittalDownloadBlock(service: ServiceClient, transmittalId: string, appUrl: string): Promise<string> {
  const { data: t } = await untypedFrom(service, TRANSMITTALS_TABLE)
    .select("entity_type, entity_id, project_id")
    .eq("id", transmittalId)
    .maybeSingle();
  if (!t) return "";
  const entityType = t.entity_type as TransmittalEntityType;
  let bucket = VAULT_BUCKET;
  let path: string | null = null;
  let verifyPath: string | null = null;
  let kind = "document";

  if (entityType === "vault_document") {
    const { data: doc } = await untypedFrom(service, VAULT_DOCUMENTS_TABLE).select("status, storage_path").eq("id", t.entity_id).maybeSingle();
    if (!doc || !canTransmit("vault_document", doc.status)) return "";
    path = doc.storage_path ?? null;
  } else {
    kind = "Data Book";
    bucket = GENERATED_DOCUMENTS_BUCKET;
    const { data: book } = await untypedFrom(service, "data_books").select("status").eq("id", t.entity_id).maybeSingle();
    if (!book || !canTransmit("data_book", book.status)) return "";
    const { data: cert } = await untypedFrom(service, "handover_certificates")
      .select("rendered_book_path, package_storage_path, verification_token, superseded_at, rejected_at")
      .eq("data_book_id", t.entity_id)
      .is("superseded_at", null)
      .limit(1)
      .maybeSingle();
    if (cert) {
      path = cert.rendered_book_path ?? cert.package_storage_path ?? null;
      if (cert.verification_token && !cert.rejected_at) verifyPath = `/verify/certificate/${cert.verification_token}`;
    }
  }

  let signedUrl: string | null = null;
  if (path) {
    const service2 = service as unknown as {
      storage: { from: (b: string) => { createSignedUrl: (p: string, s: number) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> } };
    };
    const { data, error } = await service2.storage.from(bucket).createSignedUrl(path, TRANSMITTAL_DOWNLOAD_TTL_SECONDS);
    // The error message is generic storage text; never include the path or URL in what we throw.
    if (error || !data?.signedUrl) throw new Error("Could not create the document download link");
    signedUrl = data.signedUrl;
  }
  const base = appUrl.replace(/\/+$/, "");
  return renderDownloadBlock({ signedUrl, verifyUrl: verifyPath && base ? base + verifyPath : null, entityKind: kind });
}

export { injectDownloadBlock };
