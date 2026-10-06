import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { applyNcrFilters, applyNcrSort } from "@/lib/ncrs/list-filters";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const session = await getSessionContext();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from(NCRS_TABLE)
    .select("ncr_number, severity, status, description, due_date, created_at, closed_at, projects(name, project_number)")
    .neq("severity", "observation");
  query = applyNcrFilters(query, sp, session.userId);
  if (sp.q) {
    const q = sp.q.replace(/[%,()]/g, " ");
    query = query.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
  }
  query = applyNcrSort(query, sp.sort).limit(5000);

  const { data } = await query.returns<
    {
      ncr_number: string;
      severity: string;
      status: string;
      description: string;
      due_date: string | null;
      created_at: string;
      closed_at: string | null;
      projects: { name: string; project_number: string } | null;
    }[]
  >();

  const header = ["NCR No.", "Project", "Severity", "Status", "Description", "Due date", "Raised", "Closed"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of data ?? []) {
    lines.push(
      [
        r.ncr_number,
        r.projects ? `${r.projects.project_number} ${r.projects.name}` : "",
        r.severity,
        r.status,
        r.description,
        r.due_date,
        r.created_at?.slice(0, 10),
        r.closed_at?.slice(0, 10),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ncr-register-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
