import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildItpDocx, type ItpDocxInterventionCell, type ItpDocxParty, type ItpDocxSection } from "@/lib/itps/docx";
import { rateLimitResponse } from "@/lib/api/rate-limit";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
};

/**
 * R107 — the controlled ITP as a real Word (.docx) document: ITP number/title/status/revision, each
 * section's activities, and a plain per-party intervention grid — mirroring what the PDF/.xlsx
 * exports already cover (see lib/itps/docx.ts's doc comment). Stamped "UNCONTROLLED COPY" like the
 * .xlsx export above, since this is a downloadable working copy, not the controlled record itself.
 * Auth/RLS/response pattern mirrors app/api/itps/[id]/export-xlsx/route.ts exactly: same session
 * check, same createSupabaseServerClient(), same query shape where practical.
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
  const limited = rateLimitResponse("export", user.id);
  if (limited) return limited;

  const { data: itp } = await supabase
    .from("itps")
    .select("id, itp_number, title, status, revision, project_id")
    .eq("id", id)
    .maybeSingle<{ id: string; itp_number: string; title: string; status: string; revision: number; project_id: string }>();

  if (!itp) {
    return NextResponse.json({ error: "ITP not found, or you don't have access to it." }, { status: 404 });
  }

  const [{ data: sections }, { data: parties }] = await Promise.all([
    supabase
      .from("itp_sections")
      .select(
        "id, section_number, title, itp_items(id, item_number, activity, acceptance_criteria, method, frequency, sort_order)"
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
            method: string | null;
            frequency: string | null;
            sort_order: number;
          }[];
        }[]
      >(),
    supabase
      .from("project_parties")
      .select("id, name, party_type")
      .eq("project_id", itp.project_id)
      .eq("is_active", true)
      .order("party_type")
      .returns<{ id: string; name: string; party_type: string }[]>(),
  ]);

  const itemIds = (sections ?? []).flatMap((s) => (s.itp_items ?? []).map((i) => i.id));

  const { data: interventionRows } =
    itemIds.length > 0
      ? await supabase
          .from("activity_party_intervention")
          .select("itp_item_id, project_party_id, intervention")
          .in("itp_item_id", itemIds)
          .returns<{ itp_item_id: string; project_party_id: string; intervention: string }[]>()
      : { data: [] as { itp_item_id: string; project_party_id: string; intervention: string }[] };

  const docxSections: ItpDocxSection[] = (sections ?? [])
    .map((s) => ({
      sectionNumber: s.section_number,
      title: s.title,
      items: [...(s.itp_items ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({
          id: item.id,
          itemNumber: item.item_number,
          activity: item.activity,
          acceptanceCriteria: item.acceptance_criteria,
          method: item.method,
          frequency: item.frequency,
        })),
    }))
    .sort((a, b) => a.sectionNumber - b.sectionNumber);

  const docxParties: ItpDocxParty[] = (parties ?? []).map((p) => ({ id: p.id, name: p.name }));

  const docxInterventions: ItpDocxInterventionCell[] = (interventionRows ?? []).map((row) => ({
    itpItemId: row.itp_item_id,
    projectPartyId: row.project_party_id,
    intervention: row.intervention,
  }));

  const buffer = await buildItpDocx({
    itpNumber: itp.itp_number,
    title: itp.title,
    statusLabel: STATUS_LABEL[itp.status] ?? itp.status,
    revision: itp.revision,
    sections: docxSections,
    parties: docxParties,
    interventions: docxInterventions,
  });

  // Same monorepo Buffer/BodyInit type mismatch as app/api/checklist-library/[id]/export/route.ts —
  // Node's own Buffer already satisfies BodyInit at runtime; Uint8Array sidesteps the type mismatch.
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${itp.itp_number.replace(/[^a-zA-Z0-9._-]/g, "_")}-rev${itp.revision}.docx"`,
    },
  });
}
