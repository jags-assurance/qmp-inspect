"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { CLOUD_FOLDER_SYNC_CONFIGS_TABLE, CLOUD_SYNC_PROVIDERS, type CloudSyncProvider } from "@/lib/cloud-sync/types";

export interface CloudFolderSyncConfigState {
  error: string | null;
}

const CLOUD_SYNC_PATH = "/inspect/organisation/cloud-sync";

/**
 * Saves (upserts) an organisation's SharePoint/OneDrive folder reference — the real, useful first
 * slice of R20c even with no live Graph API sync wired up yet (see lib/cloud-sync/gate.ts's own
 * comment for what that would need). Admin-only, same boundary as numbering/ITP-approval-workflow
 * (RLS's cloud_folder_sync_configs_admin_write already stops any non-staff user cold; this is the
 * business-permission check in front of it, same pattern as updateItpApprovalWorkflowAction).
 */
export async function saveCloudFolderSyncConfigAction(
  _prev: CloudFolderSyncConfigState,
  formData: FormData
): Promise<CloudFolderSyncConfigState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can configure cloud folder sync." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").trim() as CloudSyncProvider;
  const folderReference = String(formData.get("folder_reference") ?? "").trim();

  if (!organizationId) return { error: "Organisation is required." };
  if (!(CLOUD_SYNC_PROVIDERS as readonly string[]).includes(provider)) {
    return { error: "Choose SharePoint or OneDrive." };
  }
  if (!folderReference) {
    return { error: "Paste a folder URL or ID to save." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(CLOUD_FOLDER_SYNC_CONFIGS_TABLE).upsert(
    {
      organization_id: organizationId,
      provider,
      folder_reference: folderReference,
      connected_by: session.userId,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );

  if (error) {
    return { error: "Could not save the cloud folder sync configuration. Check you have permission and try again." };
  }

  revalidatePath(CLOUD_SYNC_PATH);
  return { error: null };
}

/** Clears a saved configuration back to "not configured" — an Admin changing their mind, not just
 *  overwriting a stale folder reference with a new one. */
export async function clearCloudFolderSyncConfigAction(
  _prev: CloudFolderSyncConfigState,
  formData: FormData
): Promise<CloudFolderSyncConfigState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can configure cloud folder sync." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) return { error: "Organisation is required." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(CLOUD_FOLDER_SYNC_CONFIGS_TABLE).delete().eq("organization_id", organizationId);

  if (error) {
    return { error: "Could not clear the cloud folder sync configuration. Check you have permission and try again." };
  }

  revalidatePath(CLOUD_SYNC_PATH);
  return { error: null };
}
