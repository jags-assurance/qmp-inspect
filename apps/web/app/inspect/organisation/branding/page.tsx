import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { BrandingForm } from "./branding-form";

interface OrganizationOption {
  id: string;
  name: string;
  brand_primary_color: string | null;
  brand_accent_color: string | null;
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
      .select("id, name, brand_primary_color, brand_accent_color")
      .order("name")
      .returns<OrganizationOption[]>();
    organizations = data ?? [];
  } else {
    const { data: grants } = await supabase
      .from("access_grants")
      .select("organizations(id, name, brand_primary_color, brand_accent_color, engagement_scope)")
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
        });
      }
    }
    if (organizations.length === 0) redirect("/inspect");
    restrictedToOwnOrg = true;
  }

  const { org: orgIdParam } = await searchParams;
  const selectedOrg = organizations.find((o) => o.id === orgIdParam) ?? organizations[0] ?? null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">Brand colors</h1>
      <p className="mt-1 text-sm text-muted">
        Override the default burgundy/gold theme for this organisation&rsquo;s in-app screens.
        Applies wherever a page is scoped to this organisation (e.g. its projects); generated PDF
        reports are unaffected.
      </p>

      {!restrictedToOwnOrg && (
        <OrgPickerForm
          organizations={organizations.map((o) => ({ id: o.id, name: o.name }))}
          selectedOrgId={selectedOrg?.id ?? null}
        />
      )}

      {selectedOrg && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">{selectedOrg.name}</h2>
          <div className="mt-3">
            <BrandingForm
              organizationId={selectedOrg.id}
              brandPrimaryColor={selectedOrg.brand_primary_color}
              brandAccentColor={selectedOrg.brand_accent_color}
            />
          </div>
        </div>
      )}
    </div>
  );
}
