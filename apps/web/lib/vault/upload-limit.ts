import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { untypedFrom } from "@/lib/supabase/untyped";
import { VAULT_DEFAULT_UPLOAD_MB, VAULT_UPLOAD_SETTINGS_TABLE, effectiveVaultUploadLimitMb } from "./limits";

/**
 * The Document Vault upload limit (MB) for an organisation: its own setting if a JAGS Admin set one,
 * otherwise 50. Read with the service role when it is configured, so an external uploader (who cannot read
 * the settings table) still gets their organisation's limit; only the number is returned. Any failure,
 * including the table not existing before the migration is applied, falls back to the default.
 */
export async function loadVaultUploadLimitMb(organizationId: string | null | undefined): Promise<number> {
  if (!organizationId) return VAULT_DEFAULT_UPLOAD_MB;
  try {
    const client = isServiceRoleConfigured() ? createSupabaseServiceRoleClient() : await createSupabaseServerClient();
    const { data, error } = await untypedFrom(client, VAULT_UPLOAD_SETTINGS_TABLE)
      .select("max_upload_mb")
      .eq("organization_id", organizationId)
      .maybeSingle<{ max_upload_mb: number }>();
    if (error || !data) return VAULT_DEFAULT_UPLOAD_MB;
    return effectiveVaultUploadLimitMb(data.max_upload_mb);
  } catch {
    return VAULT_DEFAULT_UPLOAD_MB;
  }
}
