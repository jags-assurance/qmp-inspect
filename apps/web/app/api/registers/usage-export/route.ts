import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/registers/csv";
import { fetchRegisterUsage } from "@/lib/registers/usage";
import { CALIBRATION_REGISTER_TABLE, MATERIAL_REGISTER_TABLE, WELDER_QUALIFICATION_REGISTER_TABLE } from "@/lib/registers/types";

const TABLES = { calibration: CALIBRATION_REGISTER_TABLE, welder: WELDER_QUALIFICATION_REGISTER_TABLE, material: MATERIAL_REGISTER_TABLE } as const;

/** CSV of every inspection answer verified against one register row (the impact report), via the caller's own access. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as keyof typeof TABLES | null;
  const id = url.searchParams.get("id");
  if (!kind || !(kind in TABLES) || !id) return NextResponse.json({ error: "Missing entry." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to export." }, { status: 401 });

  const { data: entry } = await supabase.from(TABLES[kind]).select("project_id").eq("id", id).maybeSingle<{ project_id: string }>();
  if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  try {
    const { usage } = await fetchRegisterUsage(supabase, { kind, id, projectId: entry.project_id });
    const csv = toCsv([
      ["Record", "Activity", "Checklist item", "Inspection date", "Answer", "Record result"],
      ...usage.map((u) => [
        u.record?.record_number ?? "",
        u.record?.activity ?? "",
        u.checklist_item ? `${u.checklist_item.item_number} ${u.checklist_item.description}` : "",
        u.record?.inspection_date?.slice(0, 10) ?? "",
        u.result,
        u.record?.overall_result ?? "pending",
      ]),
    ]);
    return new NextResponse(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-impact-${id.slice(0, 8)}.csv"` },
    });
  } catch {
    return NextResponse.json({ error: "Could not build the export." }, { status: 500 });
  }
}
