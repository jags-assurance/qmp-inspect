import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import type { EmailBrandOptions } from "./render";

const ORG_BRANDING_BUCKET = "org-branding";
// Emails are read days later, so sign the logo for a week (the in-app chrome uses 1 hour).
const LOGO_TTL_SECONDS = 7 * 24 * 3600;

/** Organisation name + logo for the email co-brand line. Best-effort: returns undefined on any failure. */
export async function loadEmailOrgBrand(organizationId: string | null | undefined): Promise<EmailBrandOptions | undefined> {
  if (!organizationId || !isServiceRoleConfigured()) return undefined;
  try {
    const service = createSupabaseServiceRoleClient();
    const { data } = await service
      .from("organizations")
      .select("name, branding_logo_path")
      .eq("id", organizationId)
      .maybeSingle<{ name: string | null; branding_logo_path: string | null }>();
    if (!data?.name) return undefined;
    let orgLogoUrl: string | null = null;
    if (data.branding_logo_path) {
      const { data: signed } = await service.storage.from(ORG_BRANDING_BUCKET).createSignedUrl(data.branding_logo_path, LOGO_TTL_SECONDS);
      orgLogoUrl = signed?.signedUrl ?? null;
    }
    return { orgName: data.name, orgLogoUrl };
  } catch {
    return undefined;
  }
}
