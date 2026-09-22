import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CHECKLIST_LIBRARY_TEMPLATES_TABLE } from "@/lib/checklist-library/types";
import { TemplatesTable, type LibraryTemplateRow } from "./templates-table";
import { CreateTemplateForm } from "./create-template-form";

/**
 * R44/R47: standalone checklist/form template builder — a reusable library of check-item sets,
 * independent of any specific ITP activity. Staff-only (RLS-enforced on every checklist_library_*
 * table; this redirect is a UX nicety, same as ItpMasterLibraryPage). A template built here gets
 * attached to a real ITP activity from that activity's checklist page
 * (app/inspect/itps/[id]/checklists/page.tsx), which copies its items into a fresh, project-scoped
 * checklist — the same template can be attached across many different clients' ITPs, each getting
 * its own independent, editable copy.
 */
export default async function ChecklistLibraryPage() {
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect/itps");

  const supabase = await createSupabaseServerClient();
  const [{ data: templates }, { data: disciplines }] = await Promise.all([
    supabase
      .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
      .select("id, title, description, discipline_id, master_disciplines(name), checklist_library_items(count)")
      .order("title")
      .returns<LibraryTemplateRow[]>(),
    supabase.from("master_disciplines").select("id, name").order("name").returns<{ id: string; name: string }[]>(),
  ]);

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-ink">Checklist / Form Template Library</h1>
        <p className="mt-1 text-sm text-muted">
          JAGS-internal, reusable checklist and form templates, built independently of any specific
          project. Attach one to a checklist-type ITP activity to start that activity&apos;s checklist
          from a proven set of check items instead of a blank one — never visible to clients.
        </p>
      </div>

      <div className="mt-6">
        <CreateTemplateForm disciplines={disciplines ?? []} />
      </div>

      <div className="mt-6">
        <TemplatesTable rows={templates ?? []} />
      </div>
    </div>
  );
}
