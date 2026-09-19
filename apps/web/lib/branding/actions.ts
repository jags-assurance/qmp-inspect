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
 * 20260917060000_org_brand_colors.sql and lib/branding/org-brand.ts for how it's applied).
 * Admin-only for a full_service org — but a Self-Managed client can set its OWN organization's
 * colors (20260919050000_self_managed_org_settings.sql), matching "the client manages its own
 * organization." RLS + a trigger enforce that a non-staff caller can only ever touch these two
 * columns on their own self_managed org row; this check just gives an honest error before even
 * trying, for a non-self-managed org specifically.
 */
export async function updateOrgBrandColorsAction(
  _prev: BrandingSettingsState,
  formData: FormData
): Promise<BrandingSettingsState> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) {
    return { error: "Organisation is required." };
  }

  if (!isAdminStaff(session)) {
    const { data: org } = await supabase
      .from("organizations")
      .select("engagement_scope")
      .eq("id", organizationId)
      .maybeSingle<{ engagement_scope: string }>();
    if (org?.engagement_scope !== "self_managed") {
      return { error: "Only a JAGS Admin can change this organisation's brand colors." };
    }
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
