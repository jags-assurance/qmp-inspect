import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * R91 — "exportable ITP Register... filterable and exportable to PDF and Excel." This is the
 * Excel half: a real CSV download (same "Excel via CSV" pattern already used by the monthly report
 * pack, worker/src/jobs/generateMonthlyReportPack.ts) of every row matching the register's CURRENT
 * filters — not just the current page, since a register export exists precisely so someone can take
 * the full filtered list off-platform. Mirrors the exact filter logic in app/inspect/itps/page.tsx
 * so "what you see is what you export." RLS on `itps` applies identically to this query, so a user
 * can never export more than the register itself would show them.
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const disciplineId = url.searchParams.get("discipline") ?? "";
  const projectId = url.searchParams.get("project") ?? "";
  const q = url.searchParams.get("q") ?? "";

  let itpIdFilter: string[] | null = null;
  if (disciplineId) {
    const { data: taggedItems } = await supabase
      .from("itp_items")
      .select("section_id, itp_sections(itp_id)")
      .eq("discipline_id", disciplineId)
      .returns<{ section_id: string; itp_sections: { itp_id: string } | null }[]>();
    itpIdFilter = [...new Set((taggedItems ?? []).map((i) => i.itp_sections?.itp_id).filter((id): id is string => Boolean(id)))];
  }

  let query = supabase
    .from("itps")
    .select("itp_number, title, status, revision, applicable_standard, projects(name, organizations(name))");

  if (itpIdFilter) {
    query = itpIdFilter.length === 0 ? query.eq("id", "00000000-0000-0000-0000-000000000000") : query.in("id", itpIdFilter);
  }
  if (projectId) query = query.eq("project_id", projectId);
  if (q) query = query.or(`itp_number.ilike.%${q}%,title.ilike.%${q}%`);

  const { data: itps, error } = await query
    .order("created_at", { ascending: false })
    .returns<
      {
        itp_number: string;
        title: string;
        status: string;
        revision: number;
        applicable_standard: string | null;
        projects: { name: string; organizations: { name: string } | null } | null;
      }[]
    >();

  if (error) {
    return NextResponse.json({ error: "Could not export the register." }, { status: 500 });
  }

  const STATUS_LABEL: Record<string, string> = {
    draft: "Draft",
    under_review: "Under review",
    approved: "Approved",
    client_accepted: "Client accepted",
  };

  const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = ["ITP Number", "Title", "Client", "Project", "Status", "Revision", "Applicable Standard"];
  const rows = (itps ?? []).map((itp) =>
    [
      itp.itp_number,
      itp.title,
      itp.projects?.organizations?.name ?? "",
      itp.projects?.name ?? "",
      STATUS_LABEL[itp.status] ?? itp.status,
      String(itp.revision),
      itp.applicable_standard ?? "",
    ]
      .map(escapeCsv)
      .join(",")
  );
  const csv = [header.map(escapeCsv).join(","), ...rows].join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="itp-register-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
