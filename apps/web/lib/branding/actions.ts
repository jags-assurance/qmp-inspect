"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";

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
    if (org?.engagement_scope !== "self_managed" && org?.engagement_scope !== "client_managed") {
      return { error: "Only a JAGS Admin can change this organisation's brand colors." };
    }
  }

  // Empty string means "clear back to the default JAGS palette" (stored as null), not an error.
  const primaryRaw = String(formData.get("brand_primary_color") ?? "").trim();
  const accentRaw = String(formData.get("brand_accent_color") ?? "").trim();
  // Any number of extra colors on top of the primary/accent pair — client feedback: a fixed 4-color
  // combo wasn't enough, so this is a plain repeated field (one input per color, add/remove freely
  // in the UI) rather than two fixed named fields.
  const extraColorsRaw = formData.getAll("brand_extra_colors").map((v) => String(v).trim()).filter(Boolean);
  const multiColor = formData.get("brand_multi_color_mode") === "on";

  if (primaryRaw && !HEX_COLOR_RE.test(primaryRaw)) {
    return { error: "Primary color must be a 6-digit hex code, e.g. #6b1e2c." };
  }
  if (accentRaw && !HEX_COLOR_RE.test(accentRaw)) {
    return { error: "Accent color must be a 6-digit hex code, e.g. #f5c518." };
  }
  const invalidExtra = extraColorsRaw.find((c) => !HEX_COLOR_RE.test(c));
  if (invalidExtra) {
    return { error: `"${invalidExtra}" isn't a valid 6-digit hex code.` };
  }
  if (multiColor && extraColorsRaw.length === 0) {
    return { error: "The color combo needs at least one extra color beyond primary/accent — add one, or turn the combo off." };
  }

  const { error } = await supabase
    .from("organizations")
    .update({
      brand_primary_color: primaryRaw || null,
      brand_accent_color: accentRaw || null,
      brand_extra_colors: extraColorsRaw,
      brand_multi_color_mode: multiColor,
    })
    .eq("id", organizationId);

  if (error) {
    return { error: "Could not save the brand colors. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization_branding",
    entityId: organizationId,
    action: "colors_updated",
    actorId: session.userId,
    summary: "Organisation brand colors updated",
    changes: {
      brand_primary_color: primaryRaw || null,
      brand_accent_color: accentRaw || null,
      brand_extra_colors: extraColorsRaw,
      brand_multi_color_mode: multiColor,
    },
  });

  revalidatePath(BRANDING_PATH);
  return { error: null };
}

export interface LogoUploadState {
  error: string | null;
}

const ORG_BRANDING_BUCKET = "org-branding";

/**
 * Records the storage path of a logo the browser has already uploaded straight to the (private)
 * "org-branding" bucket — same browser-uploads-then-action-records-the-row split as
 * uploadVaultDocumentAction (lib/vault/actions.ts). Reqs R113-R118: this is the missing write side
 * of organizations.branding_logo_path, a column that existed since day one but nothing ever wrote
 * to. Same admin-or-self-managed-own-org boundary as updateOrgBrandColorsAction above — logos are
 * cosmetic branding, not a commercial/assurance-integrity decision, so a self-managed client sets
 * its own exactly like it already sets its own brand colors.
 */
export async function updateOrgLogoAction(
  _prev: LogoUploadState,
  formData: FormData
): Promise<LogoUploadState> {
  const supabase = await createSupabaseServerClient();

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const storagePath = String(formData.get("storage_path") ?? "").trim();
  if (!organizationId || !storagePath) {
    return { error: "Missing organisation or uploaded file." };
  }

  const session = await requireSession();
  if (!isAdminStaff(session)) {
    const { data: org } = await supabase
      .from("organizations")
      .select("engagement_scope")
      .eq("id", organizationId)
      .maybeSingle<{ engagement_scope: string }>();
    if (org?.engagement_scope !== "self_managed" && org?.engagement_scope !== "client_managed") {
      return { error: "Only a JAGS Admin can change this organisation's logo." };
    }
  }

  // Path must actually belong to this org (matches the Storage RLS policy's own folder check) —
  // an honest error here rather than letting a mismatched path silently record the wrong logo.
  if (!storagePath.startsWith(`${organizationId}/`)) {
    return { error: "Uploaded file does not belong to this organisation." };
  }

  const { data: org, error: fetchError } = await supabase
    .from("organizations")
    .select("branding_logo_path")
    .eq("id", organizationId)
    .maybeSingle<{ branding_logo_path: string | null }>();

  const { error } = await supabase
    .from("organizations")
    .update({ branding_logo_path: storagePath })
    .eq("id", organizationId);

  if (error) {
    return { error: "Could not save the logo. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization_branding",
    entityId: organizationId,
    action: "logo_updated",
    actorId: session.userId,
    summary: "Organisation logo updated",
  });

  // Best-effort cleanup of the previous file — never fails the upload if it doesn't work.
  if (!fetchError && org?.branding_logo_path && org.branding_logo_path !== storagePath) {
    await supabase.storage.from(ORG_BRANDING_BUCKET).remove([org.branding_logo_path]);
  }

  revalidatePath(BRANDING_PATH);
  return { error: null };
}

/**
 * A short-lived signed URL for the org's current logo, for the branding page's own live preview —
 * the bucket is private, so there is no public URL to just construct. Returns null when there's no
 * logo set, or the signing call fails (never throws — a broken preview must not break the page).
 */
export async function getOrgLogoPreviewUrl(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(ORG_BRANDING_BUCKET).createSignedUrl(logoPath, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
