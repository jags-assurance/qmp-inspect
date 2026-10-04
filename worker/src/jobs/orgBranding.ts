import type { SupabaseClient } from "@supabase/supabase-js";

// Reqs R113-R118: engagement_mode already drives document *numbering* (lib/numbering/generate.ts's
// internalReference for white_label) but had no connection to *visual* branding anywhere — this is
// that connection for worker-rendered PDFs. Mirrors the semantics used there:
//   jags_led    -> JAGS branding only (today's existing behaviour, unchanged)
//   co_branded  -> JAGS branding AND the client's own logo, together
//   white_label -> the client's own logo IN PLACE OF JAGS branding, plus a small
//                  "Powered by JAGS Assurance" footer string (the literal R113 requirement)
const ORG_BRANDING_BUCKET = "org-branding";
const LOGO_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — plenty for a single Puppeteer render pass.

export type EngagementMode = "jags_led" | "co_branded" | "white_label";

export interface OrgBrandingInfo {
  engagementMode: EngagementMode;
  /**
   * Signed URL for the organisation's uploaded logo (organizations.branding_logo_path in the
   * private "org-branding" Storage bucket), or null when there is no logo to show — either because
   * none was ever uploaded, or because engagement_mode is jags_led, in which case this is never even
   * looked up: a client logo has no reason to be issued a signed URL when nothing will ever render
   * it. Never a fabricated placeholder — a null here always means "render the JAGS-only branding
   * exactly as before," never an invented image.
   */
  logoUrl: string | null;
  /**
   * The org's own accent colors (organizations.brand_primary_color/brand_accent_color — same
   * columns the web app's org-brand.ts reads for the in-app burgundy/gold CSS variable overrides),
   * only ever populated outside jags_led mode: a real gap found live — these PDF templates always
   * rendered in JAGS's fixed burgundy/gold regardless of what the org configured, even when
   * co_branded/white_label. Null means "no override, render the default palette."
   */
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}

/**
 * Looks up an organisation's engagement_mode and, when relevant, a fresh signed URL for its
 * uploaded logo — the one piece of information every branded PDF template needs to decide what to
 * put in its letterhead and footer. Best-effort: any lookup or signing failure degrades to
 * `{ engagementMode: "jags_led", logoUrl: null }` (today's unchanged rendering) rather than failing
 * the PDF job — branding must never block a document from being generated.
 */
export async function getOrgBranding(
  supabase: SupabaseClient,
  organizationId: string | null | undefined
): Promise<OrgBrandingInfo> {
  if (!organizationId) return { engagementMode: "jags_led", logoUrl: null, brandPrimaryColor: null, brandAccentColor: null };

  const { data: org } = await supabase
    .from("organizations")
    .select("engagement_mode, branding_logo_path, brand_primary_color, brand_accent_color")
    .eq("id", organizationId)
    .maybeSingle<{
      engagement_mode: EngagementMode | null;
      branding_logo_path: string | null;
      brand_primary_color: string | null;
      brand_accent_color: string | null;
    }>();

  const engagementMode: EngagementMode = org?.engagement_mode ?? "jags_led";
  // Colors are a jags_led-excluded override, same semantics as the logo — jags_led always means
  // "JAGS's own fixed palette," regardless of what an org has configured.
  const brandPrimaryColor = engagementMode === "jags_led" ? null : (org?.brand_primary_color ?? null);
  const brandAccentColor = engagementMode === "jags_led" ? null : (org?.brand_accent_color ?? null);

  if (engagementMode === "jags_led" || !org?.branding_logo_path) {
    return { engagementMode, logoUrl: null, brandPrimaryColor, brandAccentColor };
  }

  const { data: signed, error } = await supabase.storage
    .from(ORG_BRANDING_BUCKET)
    .createSignedUrl(org.branding_logo_path, LOGO_SIGNED_URL_TTL_SECONDS);

  if (error || !signed?.signedUrl) {
    return { engagementMode, logoUrl: null, brandPrimaryColor, brandAccentColor };
  }

  return { engagementMode, logoUrl: signed.signedUrl, brandPrimaryColor, brandAccentColor };
}

const BRAND_HEX = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/**
 * A `<style>` block that swaps the default burgundy/gold CSS variables for the organisation's own
 * colours (co-branded / white-label only — getOrgBranding already nulls them for jags_led). Emits
 * nothing when neither colour is a valid hex value, so the default palette is untouched. Placed
 * right after `<body>` in each PDF template so it overrides the `:root` defaults in `<head>`.
 */
export function brandColorStyle(branding: { brandPrimaryColor?: string | null; brandAccentColor?: string | null } | undefined): string {
  const primary = branding?.brandPrimaryColor;
  const accent = branding?.brandAccentColor;
  const decl = [
    primary && BRAND_HEX.test(primary) ? `--burgundy: ${primary};` : "",
    accent && BRAND_HEX.test(accent) ? `--gold: ${accent};` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return decl ? `<style>:root { ${decl} }</style>` : "";
}
