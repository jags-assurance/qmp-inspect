import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { AgingChart, bucketAge } from "@/components/ui/aging-chart";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { NcrsTable, type NcrRegisterRow } from "./ncrs-table";
import { isOverdue } from "./is-overdue";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { DisciplineFilterForm, type DisciplineOption } from "./discipline-filter-form";

export default async function NcrsPage({
  searchParams,
}: {
  searchParams: Promise<{ discipline?: string; project?: string }>;
}) {
  const session = await requireSession();
  const { discipline: disciplineId, project: projectId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: disciplines } = await supabase
    .from("master_disciplines")
    .select("id, code, name")
    .eq("is_active", true)
    .order("sort_order")
    .returns<DisciplineOption[]>();

  // NCRs don't carry a discipline_id column of their own — they only reach one through the
  // (optional, nullable) itp_item_id link to itp_items.discipline_id. So the filter is applied as
  // an id allowlist, same shape as apps/web/app/inspect/itps/page.tsx: resolve the matching
  // itp_item ids first, then .in() the NCR query by those. An NCR raised standalone (no
  // itp_item_id) simply never matches a discipline filter — it's still shown in the unfiltered
  // register, never excluded from that.
  let itpItemIdFilter: string[] | null = null;
  if (disciplineId) {
    const { data: taggedItems } = await supabase
      .from("itp_items")
      .select("id")
      .eq("discipline_id", disciplineId)
      .returns<{ id: string }[]>();

    itpItemIdFilter = (taggedItems ?? []).map((i) => i.id);
  }

  let query = supabase
    .from(NCRS_TABLE)
    .select(
      "id, ncr_number, severity, description, status, due_date, created_at, projects(name, project_number), itp_items(master_disciplines(code, name))"
    )
    .neq("severity", "observation")
    .order("created_at", { ascending: false });
  if (itpItemIdFilter) {
    query = itpItemIdFilter.length > 0 ? query.in("itp_item_id", itpItemIdFilter) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }
  if (projectId) query = query.eq("project_id", projectId);

  const { data: ncrs } = await query.returns<NcrRegisterRow[]>();

  const rows = ncrs ?? [];
  const total = rows.length;
  const open = rows.filter((r) => r.status !== "closed").length;
  const closed = rows.filter((r) => r.status === "closed").length;
  const overdue = rows.filter(isOverdue).length;
  const today = new Date().getTime();
  const openAgeDays = rows
    .filter((r) => r.status !== "closed")
    .map((r) => Math.floor((today - new Date(r.created_at).getTime()) / 86_400_000));
  const agingCounts = bucketAge(openAgeDays);

  return (
    <div>
      <RealtimeRefresh table="ncrs" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">NCR Register</h1>
          <p className="mt-1 text-sm text-muted">
            {session.isJagsStaff
              ? "Minor and major non-conformances across every project you have access to."
              : "Minor and major non-conformances on your organisation's projects."}{" "}
            <Link href="/inspect/observations" className="text-burgundy hover:underline">
              See observations →
            </Link>
          </p>
        </div>
        <Link href="/inspect/ncrs/new">
          <Button>+ Raise NCR</Button>
        </Link>
      </div>

      {projectId && (
        <p className="mt-3 text-sm text-muted">
          Filtered to one project.{" "}
          <Link href="/inspect/ncrs" className="text-burgundy hover:underline">
            Clear filter
          </Link>
        </p>
      )}

      <div className="mt-6">
        <DisciplineFilterForm disciplines={disciplines ?? []} selectedDisciplineId={disciplineId ?? null} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total" value={total} />
        <StatCard label="Open" value={open} />
        <StatCard label="Overdue" value={overdue} />
        <StatCard label="Closed" value={closed} />
      </div>

      <div className="mt-6">
        <AgingChart counts={agingCounts} />
      </div>

      <div className="mt-6">
        <NcrsTable rows={rows} />
      </div>
    </div>
  );
}
