import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { resolveSiteTimeZone, siteToday } from "@/lib/ncrs/site-date";
import { fetchProjectTimeZone } from "@/lib/projects/timezone";
import { buildVendorScorecard, type ScorecardNcr } from "@/lib/ncrs/scorecard";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";

interface Row extends ScorecardNcr {
  project_id: string;
}

export default async function NcrScorecardPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const session = await requireSession();
  // The comparison between vendors is a JAGS management view.
  if (!session.isJagsStaff) redirect("/inspect/ncrs");
  const { project: projectId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const base = "project_id, responsible_party_id, severity, status, created_at, closed_at, due_date";
  const build = (cols: string) => (from: number, to: number) => {
    let q = supabase.from(NCRS_TABLE).select(cols).neq("severity", "observation");
    if (projectId) q = q.eq("project_id", projectId);
    return q.order("id").range(from, to).returns<Row[]>();
  };
  let rows: Row[];
  try {
    // reopen_count / withdrawn_at come from the NCR hardening migration; fall back without them.
    rows = await fetchAll<Row>(build(`${base}, reopen_count, withdrawn_at`));
  } catch {
    rows = await fetchAll<Row>(build(base));
  }

  const partyIds = [...new Set(rows.map((r) => r.responsible_party_id).filter((v): v is string => !!v))];
  const partyNames = new Map<string, string>();
  for (let i = 0; i < partyIds.length; i += 150) {
    const { data } = await supabase
      .from("project_parties")
      .select("id, name")
      .in("id", partyIds.slice(i, i + 150))
      .returns<{ id: string; name: string }[]>();
    for (const p of data ?? []) partyNames.set(p.id, p.name);
  }

  const scores = buildVendorScorecard(rows, siteToday(new Date(), resolveSiteTimeZone(projectId ? await fetchProjectTimeZone(supabase, projectId) : null)));
  const num = "px-3 py-2 text-right tabular-nums";

  const scoreColumns: ResponsiveColumn<(typeof scores)[number]>[] = [
    {
      key: "party",
      header: "Responsible party",
      tdClassName: "text-ink",
      render: (s) => (s.partyId ? partyNames.get(s.partyId) ?? "Unknown party" : "No responsible party set"),
    },
    { key: "total", header: "Total", className: "text-right tabular-nums", render: (s) => s.total },
    { key: "open", header: "Open", className: "text-right tabular-nums", render: (s) => s.open },
    {
      key: "overdue",
      header: "Overdue",
      className: "text-right tabular-nums",
      tdClassName: undefined,
      render: (s) => <span className={s.overdue > 0 ? "font-medium text-danger" : ""}>{s.overdue}</span>,
    },
    { key: "major", header: "Major", className: "text-right tabular-nums", render: (s) => s.major },
    { key: "minor", header: "Minor", className: "text-right tabular-nums", render: (s) => s.minor },
    { key: "reopened", header: "Re-opened", className: "text-right tabular-nums", render: (s) => s.reopened },
    { key: "avg", header: "Avg days to close", className: "text-right tabular-nums", render: (s) => s.avgDaysToClose ?? "—" },
    {
      key: "ontime",
      header: "Closed on time",
      className: "text-right tabular-nums",
      render: (s) => (s.onTimeRate == null ? "—" : `${s.onTimeRate}%`),
    },
  ];


  return (
    <div className="max-w-6xl">
      <Link href="/inspect/ncrs" className="text-sm text-burgundy hover:underline">
        ← Back to NCR Register
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Vendor NCR scorecard</h1>
      <p className="mt-1 text-sm text-muted">
        Minor and major NCRs per responsible party. Withdrawn NCRs and observations are not counted. Worst first: most overdue, then most open.
      </p>
      {scores.length === 0 ? (
        <p className="mt-6 rounded-md bg-off-white p-4 text-sm text-muted">No NCRs to score yet.</p>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-surface">
          <ResponsiveTable
            columns={scoreColumns}
            rows={scores}
            rowKey={(s) => s.partyId ?? "none"}
            caption="Vendor NCR scorecard"
            scrollRegionLabel="Vendor NCR scorecard"
            wrapperClassName="table-scroll"
            theadClassName="text-left text-xs text-muted"
            headRowClassName=""
            thClassName="px-3 py-2 font-medium"
            tdClassName="px-3 py-2"
            rowClassName="border-t border-border"
            cardClassName="px-3"
          />
        </div>
      )}
    </div>
  );
}
