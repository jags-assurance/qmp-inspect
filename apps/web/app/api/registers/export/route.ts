import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { toCsv } from "@/lib/registers/csv";
import { REGISTER_CSV_COLUMNS, type CsvRegisterKind } from "@/lib/registers/csv-columns";
import { CALIBRATION_REGISTER_TABLE, MATERIAL_REGISTER_TABLE, PERSONNEL_CERTIFICATIONS_TABLE, WELDER_QUALIFICATION_REGISTER_TABLE } from "@/lib/registers/types";
import { rateLimitResponse } from "@/lib/api/rate-limit";

const TABLES = {
  calibration: CALIBRATION_REGISTER_TABLE,
  welder: WELDER_QUALIFICATION_REGISTER_TABLE,
  material: MATERIAL_REGISTER_TABLE,
  personnel: PERSONNEL_CERTIFICATIONS_TABLE,
} as const;

/** CSV export of one project register (everyone with project access, via their own session). ?template=1 returns just the header row. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as CsvRegisterKind | null;
  const projectId = url.searchParams.get("project_id");
  if (!kind || !(kind in TABLES) || !projectId) return NextResponse.json({ error: "Missing register or project." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to export." }, { status: 401 });
  const limited = rateLimitResponse("export", user.id);
  if (limited) return limited;

  const columns = REGISTER_CSV_COLUMNS[kind];
  const header = columns.map((c) => c.header);
  let body: (string | null)[][] = [];
  if (url.searchParams.get("template") !== "1") {
    try {
      const selectFields = columns.map((c) => (c.field === "party_name" ? "project_parties(name)" : c.field)).join(", ");
      const rows = await fetchAll<Record<string, unknown>>((from, to) =>
        supabase
          .from(TABLES[kind])
          .select(selectFields)
          .eq("project_id", projectId)
          .order("id")
          .range(from, to)
          .returns<Record<string, unknown>[]>()
      );
      body = rows.map((r) =>
        columns.map((c) => {
          if (c.field === "party_name") return (r.project_parties as { name?: string } | null)?.name ?? "";
          return (r[c.field] as string | null) ?? "";
        })
      );
    } catch {
      return NextResponse.json({ error: "Could not build the export." }, { status: 500 });
    }
  }
  return new NextResponse(toCsv([header, ...body]), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-register${url.searchParams.get("template") === "1" ? "-template" : ""}.csv"` },
  });
}
