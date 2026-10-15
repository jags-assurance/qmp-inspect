import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CHECKLIST_LIBRARY_TEMPLATES_TABLE } from "@/lib/checklist-library/types";
import { TemplatesTable, type LibraryTemplateRow } from "./templates-table";
import { CreateTemplateForm } from "./create-template-form";
import { PageGuide } from "@/components/domain/page-guide";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { MoreDetails } from "@/components/domain/more-details";
import { getTranslator } from "@/lib/i18n/server";

/**
 * R44/R47: standalone checklist/form template builder — a reusable library of check-item sets,
 * independent of any specific ITP activity. A template built here gets attached to a real ITP
 * activity from that activity's checklist page (app/inspect/itps/[id]/checklists/page.tsx), which
 * copies its items into a fresh, project-scoped checklist — the same GLOBAL template can be
 * attached across many different clients' ITPs, each getting its own independent, editable copy.
 *
 * R46: building/editing templates (and seeing the whole library) stays staff-only, but a template
 * can now optionally be scoped to one client organisation instead of always being global/shared.
 * The list query itself is what enforces "global + this org's own" for a non-staff client user —
 * the RLS policies added in 20260926020000_checklist_library_org_scope.sql already return exactly
 * that set (a global row, or one whose organization_id the viewer has org access to), and staff's
 * separate is_jags_staff() policy returns everything on top. Nothing here needs to re-filter by
 * hand; a non-staff viewer just gets a read-only list with no create form.
 */
export async function ChecklistLibraryView({ embedded }: { embedded?: boolean }) {
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();

  const supabase = await createSupabaseServerClient();
  const [{ data: templates }, { data: disciplines }, { data: organizations }] = await Promise.all([
    supabase
      .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
      .select("id, title, description, discipline_id, organization_id, master_disciplines(name), organizations(name), checklist_library_items(count)")
      .order("title")
      .returns<LibraryTemplateRow[]>(),
    session.isJagsStaff
      ? supabase.from("master_disciplines").select("id, name").order("name").returns<{ id: string; name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    session.isJagsStaff
      ? supabase.from("organizations").select("id, name").order("name").returns<{ id: string; name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const globalCount = (templates ?? []).filter((t) => !t.organization_id).length;
  const totalItems = (templates ?? []).reduce((sum, t) => sum + (t.checklist_library_items?.[0]?.count ?? 0), 0);

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className={embedded ? "text-lg font-semibold text-text-strong" : "text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]"}><T>Checklist / Form Template Library</T></Heading>
          <PageGuide
            title={tl("Checklist / Form Template Library — how this works")}
            points={[
              "Building and editing templates (and seeing the whole library) is staff-only — a client user gets a read-only list, filtered by RLS to global templates plus any built specifically for their own organisation.",
              "A template is a reusable set of check items, independent of any project — attaching it to an ITP activity's checklist copies its items into a fresh, project-scoped checklist, so the same global template can be reused across many different clients' ITPs, each getting its own independent, editable copy.",
              "A template can be scoped to one client organisation instead of always being global/shared, so per-client variants never collide with each other or the shared library.",
              "Nothing here re-filters the list by hand — the visibility rule (global, or scoped to an org you have access to, or everything if you're staff) is enforced directly by the database's RLS policies.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          <T>Reusable check items to start ITP checklists from.</T>
        </p>
        <MoreDetails className="mt-1">
          <p>
            {session.isJagsStaff
              ? "JAGS-internal, reusable checklist and form templates, built independently of any specific project. Attach one to a checklist-type ITP activity to start that activity’s checklist from a proven set of check items instead of a blank one. Global templates are shared with every client; a template can also be scoped to one client so per-client variants never collide."
              : "Checklist and form templates JAGS can start a checklist-type ITP activity from — global templates plus any built specifically for your organisation."}
          </p>
        </MoreDetails>
      </div>

      <StatGrid max={4} className="mt-6">
        <StatTile label="Templates" value={(templates ?? []).length} />
        <StatTile label="Global (shared)" value={globalCount} />
        <StatTile label="Org-specific" value={(templates ?? []).length - globalCount} />
        <StatTile label="Total check items" value={totalItems} />
      </StatGrid>

      {session.isJagsStaff && (
        <div className="mt-6">
          <CreateTemplateForm disciplines={disciplines ?? []} organizations={organizations ?? []} />
        </div>
      )}

      <div className="mt-6">
        <TemplatesTable rows={templates ?? []} />
      </div>
    </div>
  );
}
