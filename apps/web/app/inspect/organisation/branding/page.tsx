import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgLogoPreviewUrl } from "@/lib/branding/actions";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { BrandingForm } from "./branding-form";
import { LogoUploadForm } from "./logo-upload-form";

interface OrganizationOption {
  id: string;
  name: string;
  brand_primary_color: string | null;
  brand_accent_color: string | null;
  branding_logo_path: string | null;
  engagement_mode: string;
}

export default async function BrandingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Admin-only for a full_service org, same boundary as numbering/engagement-mode — but a
  // Self-Managed client can manage its OWN organization's brand colors
  // (20260919050000_self_managed_org_settings.sql), matching "the client manages its own
  // organization." A self-managed non-staff user sees only their own org, no picker.
  let organizations: OrganizationOption[] = [];
  let restrictedToOwnOrg = false;

  if (isAdminStaff(session)) {
    const { data } = await supabase
      .from("organizations")
      .select("id, name, brand_primary_color, brand_accent_color, branding_logo_path, engagement_mode")
      .order("name")
      .returns<OrganizationOption[]>();
    organizations = data ?? [];
  } else {
    const { data: grants } = await supabase
      .from("access_grants")
      .select(
        "organizations(id, name, brand_primary_color, brand_accent_color, branding_logo_path, engagement_mode, engagement_scope)"
      )
      .eq("user_id", session.userId)
      .returns<{ organizations: (OrganizationOption & { engagement_scope: string }) | null }[]>();

    const seen = new Set<string>();
    for (const g of grants ?? []) {
      const org = g.organizations;
      if (org && org.engagement_scope === "self_managed" && !seen.has(org.id)) {
        seen.add(org.id);
        organizations.push({
          id: org.id,
          name: org.name,
          brand_primary_color: org.brand_primary_color,
          brand_accent_color: org.brand_accent_color,
          branding_logo_path: org.branding_logo_path,
          engagement_mode: org.engagement_mode,
        });
      }
    }
    if (organizations.length === 0) redirect("/inspect");
    restrictedToOwnOrg = true;
  }

  const { org: orgIdParam } = await searchParams;
  const selectedOrg = organizations.find((o) => o.id === orgIdParam) ?? organizations[0] ?? null;
  const logoPreviewUrl = selectedOrg ? await getOrgLogoPreviewUrl(selectedOrg.branding_logo_path) : null;

  const ENGAGEMENT_MODE_LABEL: Record<string, string> = {
    jags_led: "JAGS-led — JAGS branding only, everywhere",
    co_branded: "Co-branded — JAGS branding plus this organisation's logo, together",
    white_label: "White-label — this organisation's logo in place of JAGS branding",
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">Brand colors &amp; logo</h1>
      <p className="mt-1 text-sm text-muted">
        Override the default burgundy/gold theme and upload this organisation&rsquo;s own logo.
        Applies wherever a page is scoped to this organisation (e.g. its projects), the app header,
        and generated PDF reports — driven together by the organisation&rsquo;s configured
        engagement mode (set under Numbering, JAGS Admin only).
      </p>

      {!restrictedToOwnOrg && (
        <OrgPickerForm
          organizations={organizations.map((o) => ({ id: o.id, name: o.name }))}
          selectedOrgId={selectedOrg?.id ?? null}
        />
      )}

      {selectedOrg && (
        <div className="mt-8 space-y-6">
          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">{selectedOrg.name}</h2>
            <p className="mt-1 text-xs text-muted">
              Engagement mode: <span className="font-medium text-ink">{ENGAGEMENT_MODE_LABEL[selectedOrg.engagement_mode] ?? selectedOrg.engagement_mode}</span>
              {selectedOrg.engagement_mode === "jags_led" && (
                <span> — a logo uploaded below won&rsquo;t be shown anywhere until the engagement mode is changed to co-branded or white-label.</span>
              )}
            </p>
            <div className="mt-3">
              <BrandingForm
                organizationId={selectedOrg.id}
                brandPrimaryColor={selectedOrg.brand_primary_color}
                brandAccentColor={selectedOrg.brand_accent_color}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink">Logo</h2>
            <p className="mt-1 text-xs text-muted">
              Shown in the app header/sidebar and generated PDF reports for co-branded and
              white-label engagements (see above). No logo means the JAGS-only branding you see
              today, unchanged.
            </p>
            <div className="mt-3">
              <LogoUploadForm organizationId={selectedOrg.id} currentLogoUrl={logoPreviewUrl} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
