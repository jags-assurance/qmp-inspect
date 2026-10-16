import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ORGANIZATION_MODULE_LICENSES_TABLE,
  MODULE_KEYS,
  MODULE_LABELS,
  type OrganizationModuleLicenseRow,
} from "@/lib/module-licensing/types";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { ModuleLicenseToggle } from "./module-license-toggle";
import { PageGuide } from "@/components/domain/page-guide";
import { Badge } from "@/components/ui/badge";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { MoreDetails } from "@/components/domain/more-details";

interface OrganizationOption {
  id: string;
  name: string;
}

/**
 * R112: per-client module licensing — lets a JAGS Admin turn individual feature modules (ITPs,
 * NCRs, Observations, Vault, Standalone Assignments, Registers, Data Book, Handover, Client Teams,
 * Custom Roles, Reporting, Power BI) on or off per organisation. Distinct from Plans & Seats
 * (app/inspect/organisation/plans), which is seat-count/tier capacity — this is feature access.
 *
 * Same page-shape convention as intervention-levels/numbering/plans: an org picker up top, then a
 * focused settings panel (here, a toggle grid) for whichever org is selected. A missing row for a
 * module means licensed (default-on) — see lib/module-licensing/access.ts's doc comment for why;
 * this page always renders every module_key with its DB value falling back to `true` so the grid
 * matches what isModuleLicensed() actually resolves.
 */
export async function ModuleLicensingSettingsView({ searchParams, embedded }: {
  searchParams: { org?: string };
  embedded?: boolean;
}) {
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect?denied=1");

  const { org: orgIdParam } = searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name")
    .order("name")
    .returns<OrganizationOption[]>();

  const selectedOrg = organizations?.find((o) => o.id === orgIdParam) ?? organizations?.[0] ?? null;

  const licenseByModule = new Map<string, boolean>();
  if (selectedOrg) {
    const { data } = await supabase
      .from(ORGANIZATION_MODULE_LICENSES_TABLE)
      .select("module_key, is_licensed")
      .eq("organization_id", selectedOrg.id)
      .returns<Pick<OrganizationModuleLicenseRow, "module_key" | "is_licensed">[]>();
    for (const row of data ?? []) {
      licenseByModule.set(row.module_key, row.is_licensed);
    }
  }

  const offCount = selectedOrg ? MODULE_KEYS.filter((k) => (licenseByModule.get(k) ?? true) === false).length : 0;

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className={embedded ? "text-lg font-semibold text-text-strong" : "text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]"}><T>Module licensing</T></Heading>
        <PageGuide
          title={tl("Module licensing — how this works")}
          points={[
            "Admin-only — turns individual feature modules (ITPs, NCRs, Observations, Vault, Standalone Assignments, Registers, Data Book, Handover, Client Teams, Custom Roles, Reporting, Power BI) on or off per organisation.",
            "Every module is licensed by default — a missing row for a module means it's on; you only ever switch one off here to restrict a client.",
            "Distinct from Plans & Seats: this is feature access, not seat-count/tier capacity.",
            "JAGS staff logins always see every module regardless of this setting, so support work for a client is never blocked by that client's own licensing.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted"><T>Switch modules on or off for a client.</T></p>
      <MoreDetails className="mt-1">
        <p><T>Turn individual feature modules on or off for a client organisation. Every module is</T>{" "}
        <strong><T>licensed by default</T></strong> <T>— switch one off here only when a client should not have access to it. JAGS staff logins always see every module regardless of this setting, so support work is never blocked by a client&rsquo;s own licensing.</T></p>
      </MoreDetails>

      <OrgPickerForm organizations={organizations ?? []} selectedOrgId={selectedOrg?.id ?? null} />

      {selectedOrg && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">{selectedOrg.name}<T>&rsquo;s modules</T></h2>
            <Badge tone={offCount === 0 ? "success" : "warning"}>
              {offCount === 0 ? `All ${MODULE_KEYS.length} licensed` : `${offCount} of ${MODULE_KEYS.length} off`}
            </Badge>
          </div>

          <div className="mt-3 divide-y divide-border">
            {MODULE_KEYS.map((moduleKey) => (
              <ModuleLicenseToggle
                key={moduleKey}
                organizationId={selectedOrg.id}
                moduleKey={moduleKey}
                label={MODULE_LABELS[moduleKey]}
                isLicensed={licenseByModule.get(moduleKey) ?? true}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
