import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { mergeCategories, type CategoryRow } from "@/lib/ncrs/taxonomy";
import { AddCategoryForm, EditCategoryRow } from "./root-causes-forms";

/**
 * NCR root-cause categories (S5-22): the list an inspector picks from when closing out an NCR. The platform
 * ships defaults; an Admin adds organisation-specific categories and can rename, re-order or switch off their
 * own. Existing NCRs keep the code they were closed with, so changing the list never rewrites history.
 */
export async function RootCausesView({ searchParams, embedded }: { searchParams: { org?: string }; embedded?: boolean }) {
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();
  const { data: organizations } = await supabase.from("organizations").select("id, name").order("name").returns<{ id: string; name: string }[]>();
  const selectedOrg = organizations?.find((o) => o.id === searchParams.org) ?? organizations?.[0] ?? null;

  let rows: CategoryRow[] = [];
  const usage = new Map<string, number>();
  let unavailable = false;
  if (selectedOrg) {
    const { data, error } = await untypedFrom(supabase, "ncr_root_cause_categories")
      .select("id, organization_id, code, label, sort_order, is_active")
      .or(`organization_id.is.null,organization_id.eq.${selectedOrg.id}`)
      .returns<CategoryRow[]>();
    if (error) unavailable = true;
    rows = data ?? [];

    // How many of this organisation's NCRs closed out with each category (a count per code).
    const { data: ncrs } = await untypedFrom(supabase, "ncrs")
      .select("root_cause_category, projects!inner(organization_id)")
      .eq("projects.organization_id", selectedOrg.id)
      .not("root_cause_category", "is", null)
      .limit(5000)
      .returns<{ root_cause_category: string }[]>();
    for (const n of ncrs ?? []) usage.set(n.root_cause_category, (usage.get(n.root_cause_category) ?? 0) + 1);
  }
  const merged = mergeCategories(rows);

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink">NCR root causes</Heading>
        <PageGuide
          title="NCR root causes — how this works"
          points={[
            "These are the categories offered when an NCR is closed out. They also drive the root-cause counts you see here.",
            "The platform defaults are always available. Add your own for this organisation, or rename, re-order or switch off the ones you added.",
            "Switching a category off only hides it from new NCRs. Past NCRs keep what they were closed with.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">The list of root-cause categories used when closing NCRs.</p>

      <OrgPickerForm organizations={organizations ?? []} selectedOrgId={selectedOrg?.id ?? null} />

      {unavailable && (
        <p className="mt-6 rounded-md bg-warning/10 px-3 py-2 text-sm text-ink">The root-cause list is not available (the NCR database update has not been applied).</p>
      )}

      {selectedOrg && !unavailable && (
        <>
          <AddCategoryForm organizationId={selectedOrg.id} />
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {merged.map((c) =>
              c.organization_id === null ? (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="w-64 text-ink">{c.label}</span>
                  <span className="text-xs text-muted">Platform default · {usage.get(c.code) ?? 0} NCR{(usage.get(c.code) ?? 0) === 1 ? "" : "s"}</span>
                </li>
              ) : (
                <li key={c.id}>
                  <EditCategoryRow
                    id={c.id}
                    organizationId={selectedOrg.id}
                    label={c.label}
                    sortOrder={c.sort_order}
                    isActive={c.is_active}
                    used={usage.get(c.code) ?? 0}
                  />
                </li>
              )
            )}
          </ul>
        </>
      )}
    </div>
  );
}
