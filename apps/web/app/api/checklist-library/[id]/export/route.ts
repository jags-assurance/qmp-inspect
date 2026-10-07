import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import {
  CHECKLIST_LIBRARY_TEMPLATES_TABLE,
  CHECKLIST_LIBRARY_ITEMS_TABLE,
  type ChecklistLibraryItemRow,
} from "@/lib/checklist-library/types";
import { buildLibraryTemplateWorkbook } from "@/lib/checklist-library/xlsx";
import { rateLimitResponse } from "@/lib/api/rate-limit";

/**
 * R47: a real .xlsx download of a checklist library template's structure (item number,
 * description, acceptance criteria, evidence type) — the exact layout the import panel
 * (app/inspect/organisation/checklist-library/[id]/import-panel.tsx) expects on re-upload.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const limited = rateLimitResponse("export", session.userId);
  if (limited) return limited;
  if (!session.isJagsStaff) {
    return NextResponse.json({ error: "Only JAGS staff can export checklist library templates." }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: template } = await supabase
    .from(CHECKLIST_LIBRARY_TEMPLATES_TABLE)
    .select("id, title")
    .eq("id", id)
    .maybeSingle<{ id: string; title: string }>();

  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const { data: items } = await supabase
    .from(CHECKLIST_LIBRARY_ITEMS_TABLE)
    .select("id, library_template_id, item_number, description, acceptance_criteria, evidence_type, is_mandatory, sort_order, created_at")
    .eq("library_template_id", id)
    .order("sort_order")
    .returns<ChecklistLibraryItemRow[]>();

  const buffer = await buildLibraryTemplateWorkbook(template.title, items ?? []);
  const safeTitle = template.title.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "checklist-template";

  // Same monorepo @types/node hoisting mismatch as xlsx.ts's load() call — Uint8Array is a valid
  // BodyInit and this Buffer already is one at runtime.
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeTitle}.xlsx"`,
    },
  });
}
