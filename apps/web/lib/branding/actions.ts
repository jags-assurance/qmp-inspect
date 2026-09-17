"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";

export interface BrandingSettingsState {
  error: string | null;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const BRANDING_PATH = "/inspect/organisation/branding";

/**
 * Per-organisation display override for the fixed burgundy/gold theme (see
 * 20260917060000_org_brand_colors.sql and lib/branding/org-brand.ts for how it's applied). Admin-
 * only, same boundary as engagement mode/numbering — this is account-administrative branding
 * configuration, not a day-to-day Inspector task.
 */
export async function updateOrgBrandColorsAction(
  _prev: BrandingSettingsState,
  formData: FormData
): Promise<BrandingSettingsState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change an organisation's brand colors." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) {
    return { error: "Organisation is required." };
  }

  // Empty string means "clear back to the default JAGS palette" (stored as null), not an error.
  const primaryRaw = String(formData.get("brand_primary_color") ?? "").trim();
  const accentRaw = String(formData.get("brand_accent_color") ?? "").trim();

  if (primaryRaw && !HEX_COLOR_RE.test(primaryRaw)) {
    return { error: "Primary color must be a 6-digit hex code, e.g. #6b1e2c." };
  }
  if (accentRaw && !HEX_COLOR_RE.test(accentRaw)) {
    return { error: "Accent color must be a 6-digit hex code, e.g. #f5c518." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      brand_primary_color: primaryRaw || null,
      brand_accent_color: accentRaw || null,
    })
    .eq("id", organizationId);

  if (error) {
    return { error: "Could not save the brand colors. Check you have permission and try again." };
  }

  revalidatePath(BRANDING_PATH);
  return { error: null };
}
