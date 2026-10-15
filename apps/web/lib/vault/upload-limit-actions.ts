"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingDbObject } from "@/lib/databook/db-errors";
import { VAULT_UPLOAD_SETTINGS_TABLE, parseVaultUploadLimitMb } from "./limits";

export interface VaultUploadLimitState {
  error: string | null;
  success?: string | null;
}

/** Admin-only: sets how large a single Document Vault upload may be for one organisation (1-500 MB, default 50). */
export async function saveVaultUploadLimitAction(_prev: VaultUploadLimitState, formData: FormData): Promise<VaultUploadLimitState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can change the upload limit." };

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) return { error: "Missing organisation." };
  const parsed = parseVaultUploadLimitMb(formData.get("max_upload_mb"));
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await untypedFrom(supabase, VAULT_UPLOAD_SETTINGS_TABLE).upsert(
    { organization_id: organizationId, max_upload_mb: parsed.mb, updated_by: session.userId, updated_at: new Date().toISOString() },
    { onConflict: "organization_id" }
  );
  if (error) {
    if (isMissingDbObject(error)) return { error: "The upload limit needs the latest database update (migration 20261211000100). Ask a JAGS Admin to apply it." };
    return { error: "Could not save the upload limit. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "vault_upload_limit_updated",
    actorId: session.userId,
    summary: `Document Vault upload limit set to ${parsed.mb} MB`,
    changes: { max_upload_mb: parsed.mb },
  });

  revalidatePath("/inspect/settings");
  revalidatePath("/inspect/organisation/retention");
  return { error: null, success: `Upload limit saved: ${parsed.mb} MB per file.` };
}
