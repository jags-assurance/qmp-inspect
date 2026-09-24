import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CHECKLIST_LIBRARY_TEMPLATES_TABLE } from "@/lib/checklist-library/types";
import { TemplatesTable, type LibraryTemplateRow } from "./templates-table";
import { CreateTemplateForm } from "./create-template-form";
import { PageGuide } from "@/components/domain/page-guide";

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
export default async function ChecklistLibraryPage() {
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

  return (
    <div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink">Checklist / Form Template Library</h1>
          <PageGuide
            title="Checklist / Form Template Library — how this works"
            points={[
              "Building and editing templates (and seeing the whole library) is staff-only — a client user gets a read-only list, filtered by RLS to global templates plus any built specifically for their own organisation.",
              "A template is a reusable set of check items, independent of any project — attaching it to an ITP activity's checklist copies its items into a fresh, project-scoped checklist, so the same global template can be reused across many different clients' ITPs, each getting its own independent, editable copy.",
              "A template can be scoped to one client organisation instead of always being global/shared, so per-client variants never collide with each other or the shared library.",
              "Nothing here re-filters the list by hand — the visibility rule (global, or scoped to an org you have access to, or everything if you're staff) is enforced directly by the database's RLS policies.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {session.isJagsStaff
            ? "JAGS-internal, reusable checklist and form templates, built independently of any specific project. Attach one to a checklist-type ITP activity to start that activity’s checklist from a proven set of check items instead of a blank one. Global templates are shared with every client; a template can also be scoped to one client so per-client variants never collide."
            : "Checklist and form templates JAGS can start a checklist-type ITP activity from — global templates plus any built specifically for your organisation."}
        </p>
      </div>

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
