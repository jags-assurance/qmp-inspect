import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildItpWorkbook, OFFLINE_WORKBOOK_HEADERS, type OfflineWorkbookSourceSection } from "@/lib/itps/offline-workbook";
import { stampUncontrolledCopyBanner } from "@/lib/itps/xlsx-uncontrolled-copy";

/**
 * R41 — "download an AI-drafted ITP... edit it offline... re-upload as a new validated revision."
 * This is the download half: the ITP's CURRENT sections/items (live content, never a cached/stale
 * copy) as a real .xlsx workbook, in exactly the column layout lib/itps/offline-workbook.ts's parser
 * expects back — so the re-upload form on the ITP page (offline-revision-form.tsx) can read it
 * without any special-casing. Works on any ITP regardless of whether it originated from an AI draft,
 * a master template, or manual entry — the "AI" connection is only that this closes the loop AI
 * drafts started (ai-draft-actions.ts), not a restriction on which ITPs this export applies to.
 * RLS-scoped like every other read in this app: a user who can't open the ITP page can't download it
 * either — the `itps` select below simply returns nothing for them.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: itp } = await supabase
    .from("itps")
    .select("id, itp_number, title, revision")
    .eq("id", id)
    .maybeSingle<{ id: string; itp_number: string; title: string; revision: number }>();

  if (!itp) {
    return NextResponse.json({ error: "ITP not found, or you don't have access to it." }, { status: 404 });
  }

  const [{ data: sections }, { data: disciplines }] = await Promise.all([
    supabase
      .from("itp_sections")
      .select(
        "id, section_number, title, itp_items(id, item_number, activity, acceptance_criteria, evidence_type, discipline_id, sort_order)"
      )
      .eq("itp_id", id)
      .order("section_number")
      .returns<
        {
          id: string;
          section_number: number;
          title: string;
          itp_items: {
            id: string;
            item_number: string;
            activity: string;
            acceptance_criteria: string | null;
            evidence_type: 1 | 2 | 3;
            discipline_id: string | null;
            sort_order: number;
          }[];
        }[]
      >(),
    supabase.from("master_disciplines").select("id, code").returns<{ id: string; code: string }[]>(),
  ]);

  const disciplineCodeById = new Map((disciplines ?? []).map((d) => [d.id, d.code]));

  const sourceSections: OfflineWorkbookSourceSection[] = (sections ?? []).map((s) => ({
    sectionNumber: s.section_number,
    title: s.title,
    items: [...(s.itp_items ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        itemNumber: item.item_number,
        activity: item.activity,
        acceptanceCriteria: item.acceptance_criteria,
        evidenceType: item.evidence_type,
        disciplineCode: item.discipline_id ? disciplineCodeById.get(item.discipline_id) ?? null : null,
      })),
  }));

  const workbook = buildItpWorkbook(
    { itpNumber: itp.itp_number, title: itp.title, revision: itp.revision },
    sourceSections
  );

  // R107 — this downloadable working copy of a controlled ITP is not itself the controlled record
  // (see lib/itps/xlsx-uncontrolled-copy.ts's doc comment); insert a banner row above the existing
  // title/instructions rows rather than overwriting them, so the re-upload parser (which locates
  // the header row by its text, not a fixed row number) keeps working unchanged.
  const sheet = workbook.worksheets[0];
  sheet.spliceRows(1, 0, []);
  stampUncontrolledCopyBanner(sheet, OFFLINE_WORKBOOK_HEADERS.length);

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${itp.itp_number.replace(/[^a-zA-Z0-9._-]/g, "_")}-rev${itp.revision}.xlsx"`,
    },
  });
}
