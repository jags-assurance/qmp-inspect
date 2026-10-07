// Deliberately NOT "use server": takes a live Supabase client and is only called from other server actions.

import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Marks the APPROVED vault documents of a project whose document_reference is one of `references` as
 * superseded. Used when a record is re-opened (an NCR close-out certificate / dossier, an inspection
 * report): the filed document no longer describes the record, so it must stop reading as current and
 * stop shipping in the whole-project download. Best-effort: returns the number updated, never throws.
 * The vault guard allows this for JAGS staff and approvers only.
 */
export async function supersedeVaultDocumentsByReference(supabase: Supabase, projectId: string, references: string[]): Promise<number> {
  try {
    if (references.length === 0) return 0;
    const { data: folders } = await supabase.from("vault_folders").select("id").eq("project_id", projectId).returns<{ id: string }[]>();
    const folderIds = (folders ?? []).map((f) => f.id);
    if (folderIds.length === 0) return 0;
    const { data: updated } = await supabase
      .from("vault_documents")
      .update({ status: "superseded" })
      .in("folder_id", folderIds)
      .in("document_reference", references)
      .eq("status", "approved")
      .select("id");
    return updated?.length ?? 0;
  } catch {
    return 0;
  }
}
