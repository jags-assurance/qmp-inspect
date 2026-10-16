import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CHECKLIST_LIBRARY_TEMPLATES_TABLE,
  CHECKLIST_LIBRARY_ITEMS_TABLE,
  type ChecklistLibraryItemRow,
  type ChecklistLibraryTemplateRow,
} from "@/lib/checklist-library/types";
import { AddItemForm } from "./add-item-form";
import { ItemsTable } from "./items-table";
import { ImportPanel } from "./import-panel";
import { ExportButton } from "./export-button";
import { EditTemplateForm } from "./edit-template-form";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

/**
 * R46: staff get the full builder (edit details incl. client scope, add/import/export items).
 * A non-staff viewer only ever reaches a template row that RLS already resolved as visible to them
 * (global, or scoped to their own organisation — see 20260926020000_checklist_library_org_scope.sql)
 * — .maybeSingle() naturally 404s on anything else, no app-layer redirect needed. They get a
 * read-only view: no edit form, no add/import/export actions.
 */
export default async function ChecklistLibraryTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const tl = await getTranslator();
  const { id } = await params;
  const session = await requireSession();

  const supabase = await createSupabaseServerClient();

  const { data: template } = await supabase
    .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
    .select("id, title, description, discipline_id, organization_id, master_disciplines(name), organizations(name)")
    .eq("id", id)
    .maybeSingle<ChecklistLibraryTemplateRow & { master_disciplines: { name: string } | null; organizations: { name: string } | null }>();

  if (!template) notFound();

  const { data: items } = await supabase
    .from(CHECKLIST_LIBRARY_ITEMS_TABLE)
    .select("id, library_template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order")
    .eq("library_template_id", id)
    .order("sort_order")
    .returns<ChecklistLibraryItemRow[]>();

  const [{ data: disciplines }, { data: organizations }] = session.isJagsStaff
    ? await Promise.all([
        supabase.from("master_disciplines").select("id, name").order("name").returns<{ id: string; name: string }[]>(),
        supabase.from("organizations").select("id, name").order("name").returns<{ id: string; name: string }[]>(),
      ])
    : [{ data: [] as { id: string; name: string }[] }, { data: [] as { id: string; name: string }[] }];

  return (
    <div>
      <SettingsBackLink href="/inspect/settings?section=checklist-library" label="Checklist / Form Template Library" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]">{template.title}</h1>
            <PageGuide
              title={tl("Checklist / Form Template — how this works")}
              points={[
                "Staff get the full builder here: edit the template's details (including which client org it's scoped to, if any), add/import/export items. A non-staff viewer only ever reaches a template RLS already resolved as visible to them (global, or scoped to their own org) and gets a read-only view — no edit form, no add/import/export actions.",
                "You only ever reach this page for a template you're allowed to see — a non-staff user requesting one outside their visibility gets a plain 404, no separate redirect logic needed.",
                "Editing items here never touches any ITP that already copied this template's items — those copies are independent per-project checklists from the moment they're created.",
                "Import/Export (from Excel) and Export are staff-only, same as everything else on this page besides the read-only item list.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {template.master_disciplines?.name ?? "No discipline set"}
            {template.description ? ` · ${template.description}` : ""}
            {" · "}
            {template.organizations?.name ?? "Global — shared with every client"}
          </p>
        </div>
        {session.isJagsStaff && <ExportButton templateId={template.id} />}
      </div>

      {session.isJagsStaff && (
        <div className="mt-6">
          <EditTemplateForm
            templateId={template.id}
            title={template.title}
            description={template.description}
            disciplineId={template.discipline_id}
            organizationId={template.organization_id}
            disciplines={disciplines ?? []}
            organizations={organizations ?? []}
          />
        </div>
      )}

      <div className="mt-6">
        <ItemsTable templateId={template.id} items={items ?? []} editable={session.isJagsStaff} />
      </div>

      {session.isJagsStaff && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold text-ink"><T>Add an item</T></h2>
            <div className="mt-2">
              <AddItemForm templateId={template.id} />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-ink"><T>Import from Excel</T></h2>
            <div className="mt-2">
              <ImportPanel templateId={template.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
