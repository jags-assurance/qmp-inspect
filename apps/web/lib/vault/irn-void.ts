// Deliberately NOT "use server": takes a live Supabase client and is only called from other server
// actions (voidIrnAction / the inspection re-open action).

import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * When an IRN is voided, its filed certificate(s) in the Document Vault (document_reference =
 * irn_number) must stop reading as current. Marks every non-superseded one 'superseded' using the
 * caller's own session (vault_documents_update RLS allows project org members; the approval guard
 * trigger only fires for status='approved' or approval-field changes, so this is allowed). Callers
 * are staff-only. Best-effort: returns the number of rows updated, never throws.
 */
export async function supersedeIrnVaultDocuments(supabase: Supabase, projectId: string, irnNumber: string): Promise<number> {
  try {
    const { data: folders } = await supabase.from("vault_folders").select("id").eq("project_id", projectId).returns<{ id: string }[]>();
    const folderIds = (folders ?? []).map((f) => f.id);
    if (folderIds.length === 0) return 0;
    const { data: updated } = await supabase
      .from("vault_documents")
      .update({ status: "superseded" })
      .in("folder_id", folderIds)
      .eq("document_reference", irnNumber)
      .neq("status", "superseded")
      .select("id");
    return updated?.length ?? 0;
  } catch {
    return 0;
  }
}
