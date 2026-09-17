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
  // Same boundary as numbering/engagement-mode: account-administrative branding config, Admin-only.
  if (!isAdminStaff(session)) redirect("/inspect");

  const { org: orgIdParam } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name, brand_primary_color, brand_accent_color")
    .order("name")
    .returns<OrganizationOption[]>();

  const selectedOrg = organizations?.find((o) => o.id === orgIdParam) ?? organizations?.[0] ?? null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">Brand colors</h1>
      <p className="mt-1 text-sm text-muted">
        Override the default burgundy/gold theme for this organisation&rsquo;s in-app screens.
        Applies wherever a page is scoped to this organisation (e.g. its projects); generated PDF
        reports are unaffected.
      </p>

      <OrgPickerForm
        organizations={(organizations ?? []).map((o) => ({ id: o.id, name: o.name }))}
        selectedOrgId={selectedOrg?.id ?? null}
      />

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
