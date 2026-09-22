import { notFound, redirect } from "next/navigation";
import Link from "next/link";
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

export default async function ChecklistLibraryTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect/itps");

  const supabase = await createSupabaseServerClient();

  const { data: template } = await supabase
    .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
    .select("id, title, description, discipline_id, master_disciplines(name)")
    .eq("id", id)
    .maybeSingle<ChecklistLibraryTemplateRow & { master_disciplines: { name: string } | null }>();

  if (!template) notFound();

  const { data: items } = await supabase
    .from(CHECKLIST_LIBRARY_ITEMS_TABLE)
    .select("id, library_template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order")
    .eq("library_template_id", id)
    .order("sort_order")
    .returns<ChecklistLibraryItemRow[]>();

  return (
    <div>
      <Link href="/inspect/organisation/checklist-library" className="text-sm text-burgundy hover:underline">
        ← Back to Checklist / Form Template Library
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{template.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {template.master_disciplines?.name ?? "No discipline set"}
            {template.description ? ` · ${template.description}` : ""}
          </p>
        </div>
        <ExportButton templateId={template.id} />
      </div>

      <div className="mt-6">
        <ItemsTable templateId={template.id} items={items ?? []} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Add an item</h2>
          <div className="mt-2">
            <AddItemForm templateId={template.id} />
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink">Import from Excel</h2>
          <div className="mt-2">
            <ImportPanel templateId={template.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
