import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { VAULT_DOCUMENTS_TABLE } from "./types";

interface Client {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table handle
  from: (table: any) => any;
}

export type FinalizeOutcome = { kind: "approved" } | { kind: "not_awaiting_review" } | { kind: "error" };

/**
 * Flips a document from for_review to approved and retires the other copies of its reference.
 * The database allows ONE approved copy per (folder, reference), so the order matters: retire first,
 * approve second. `vault_approve_document` does both in one transaction. Until that migration is
 * applied this falls back to the previous two-step path (approve, then supersede best-effort).
 */
export async function finalizeDocumentApproval(supabase: unknown, documentId: string, userId: string): Promise<FinalizeOutcome> {
  const db = supabase as Client;
  const { data, error } = await db.rpc("vault_approve_document", { p_document_id: documentId, p_approved_by: userId });
  if (!error) return data === true ? { kind: "approved" } : { kind: "not_awaiting_review" };
  if (!isMissingSchemaError(error)) {
    // 40001 = it stopped being "for review" between our read and write.
    return error.code === "40001" ? { kind: "not_awaiting_review" } : { kind: "error" };
  }

  const { data: approvedRows, error: updateError } = await db
    .from(VAULT_DOCUMENTS_TABLE)
    .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("status", "for_review")
    .select("id");
  if (updateError) return { kind: "error" };
  if (!approvedRows?.length) return { kind: "not_awaiting_review" };

  try {
    const { data: doc } = await db
      .from(VAULT_DOCUMENTS_TABLE)
      .select("id, folder_id, document_reference")
      .eq("id", documentId)
      .maybeSingle();
    if (doc?.document_reference) {
      await db
        .from(VAULT_DOCUMENTS_TABLE)
        .update({ status: "superseded", superseded_by: doc.id })
        .eq("folder_id", doc.folder_id)
        .eq("document_reference", doc.document_reference)
        .neq("id", doc.id)
        .neq("status", "superseded");
    }
  } catch {
    // Best-effort — the approval itself already succeeded.
  }
  return { kind: "approved" };
}
