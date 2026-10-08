import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { applyNcrFilters, applyNcrSort } from "@/lib/ncrs/list-filters";
import { userNames } from "@/lib/ncrs/recipients";
import { fetchProjectTimeZone } from "@/lib/projects/timezone";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";

const EXPORT_LIMIT = 5000;
const BASE_COLS = "ncr_number, severity, status, description, due_date, created_at, closed_at, root_cause, corrective_action, preventive_action, requirement_not_met, projects(name, project_number), assigned_to, party:project_parties(name)";
const EXTENDED_COLS = ", location, equipment_tag, spec_reference, root_cause_category, disposition, cost_impact, schedule_impact_days, withdrawn_at";

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

  type Row = {
    ncr_number: string;
    severity: string;
    status: string;
    description: string;
    due_date: string | null;
    created_at: string;
    closed_at: string | null;
    root_cause: string | null;
    corrective_action: string | null;
    preventive_action: string | null;
    requirement_not_met: string | null;
    projects: { name: string; project_number: string } | null;
    assigned_to: string | null;
    party: { name: string } | null;
    location?: string | null;
    equipment_tag?: string | null;
    spec_reference?: string | null;
    root_cause_category?: string | null;
    disposition?: string | null;
    cost_impact?: number | null;
    schedule_impact_days?: number | null;
    withdrawn_at?: string | null;
  };
  const filterTz = sp.project ? await fetchProjectTimeZone(supabase, sp.project) : null;
  const build = (cols: string) => {
    let query = supabase.from(NCRS_TABLE).select(cols).neq("severity", "observation");
    query = applyNcrFilters(query, sp, session.userId, filterTz);
    if (sp.q) {
      const q = sp.q.replace(/[%,()]/g, " ");
      query = query.or(`ncr_number.ilike.%${q}%,description.ilike.%${q}%`);
    }
    // Page in 1000-row chunks (PostgREST cap) up to EXPORT_LIMIT, plus one probe row to detect truncation.
    return applyNcrSort(query, sp.sort);
  };
  const fetchRows = async (cols: string): Promise<Row[]> => {
    const out: Row[] = [];
    for (let from = 0; from <= EXPORT_LIMIT; from += 1000) {
      const { data, error } = (await build(cols).range(from, Math.min(from + 999, EXPORT_LIMIT))) as { data: Row[] | null; error: unknown };
      if (error) throw error;
      out.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    return out;
  };
  let rows: Row[];
  let extended = true;
  try {
    rows = await fetchRows(BASE_COLS + EXTENDED_COLS);
  } catch (e) {
    if (!isMissingSchemaError(e as { code?: string; message?: string })) return new NextResponse("Could not build the export.", { status: 500 });
    extended = false;
    try {
      rows = await fetchRows(BASE_COLS);
    } catch {
      return new NextResponse("Could not build the export.", { status: 500 });
    }
  }
  const truncated = rows.length > EXPORT_LIMIT;
  if (truncated) rows = rows.slice(0, EXPORT_LIMIT);

  const names = await userNames(supabase, rows.map((r) => r.assigned_to ?? ""));
  const header = ["NCR No.", "Project", "Severity", "Status", "Description", "Requirement not met", "Assignee", "Responsible party", "Due date", "Raised", "Closed", "Root cause", "Corrective action", "Preventive action"];
  if (extended) header.push("Location", "Equipment tag", "Spec clause", "Root-cause category", "Disposition", "Cost impact", "Schedule impact (days)", "Withdrawn");
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const cells: unknown[] = [
      r.ncr_number,
      r.projects ? `${r.projects.project_number} ${r.projects.name}` : "",
      r.severity,
      r.status,
      r.description,
      r.requirement_not_met,
      r.assigned_to ? names.get(r.assigned_to) ?? "" : "",
      r.party?.name,
      r.due_date,
      r.created_at?.slice(0, 10),
      r.closed_at?.slice(0, 10),
      r.root_cause,
      r.corrective_action,
      r.preventive_action,
    ];
    if (extended) cells.push(r.location, r.equipment_tag, r.spec_reference, r.root_cause_category, r.disposition, r.cost_impact, r.schedule_impact_days, r.withdrawn_at ? "yes" : "");
    lines.push(cells.map(csvCell).join(","));
  }
  if (truncated) lines.push(csvCell(`NOTE: export limited to the first ${EXPORT_LIMIT} rows - narrow the filters to export the rest.`));
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ncr-register-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
