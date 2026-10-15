import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { resolveSiteTimeZone, siteToday } from "@/lib/ncrs/site-date";
import { fetchProjectTimeZone } from "@/lib/projects/timezone";
import { buildVendorScorecard, type ScorecardNcr } from "@/lib/ncrs/scorecard";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { PageHeader } from "@/components/ui/page-header";
import { T } from "@/components/domain/t";

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
  const num = "px-3 py-2 text-end tabular-nums";

  const scoreColumns: ResponsiveColumn<(typeof scores)[number]>[] = [
    {
      key: "party",
      header: "Responsible party",
      cardHidden: true,
      tdClassName: "text-ink",
      render: (s) => (s.partyId ? partyNames.get(s.partyId) ?? "Unknown party" : "No responsible party set"),
    },
    { key: "total", header: "Total", className: "text-end tabular-nums", render: (s) => s.total },
    { key: "open", header: "Open", className: "text-end tabular-nums", render: (s) => s.open },
    {
      key: "overdue",
      header: "Overdue",
      className: "text-end tabular-nums",
      tdClassName: undefined,
      render: (s) => <span className={s.overdue > 0 ? "font-medium text-danger" : ""}>{s.overdue}</span>,
    },
    { key: "major", header: "Major", className: "text-end tabular-nums", render: (s) => s.major },
    { key: "minor", header: "Minor", className: "text-end tabular-nums", render: (s) => s.minor },
    { key: "reopened", header: "Re-opened", className: "text-end tabular-nums", render: (s) => s.reopened },
    { key: "avg", header: "Avg days to close", className: "text-end tabular-nums", render: (s) => s.avgDaysToClose ?? "—" },
    {
      key: "ontime",
      header: "Closed on time",
      className: "text-end tabular-nums",
      render: (s) => (s.onTimeRate == null ? "—" : `${s.onTimeRate}%`),
    },
  ];


  return (
    <div className="max-w-6xl">
      <PageHeader
        backHref="/inspect/ncrs"
        backLabel="Back to NCR Register"
        title={<T>Vendor NCR scorecard</T>}
        subtitle={<T>Per responsible party, worst first. Withdrawn NCRs and observations are not counted.</T>}
      />
      {scores.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted shadow-xs"><T>No NCRs to score yet.</T></p>
      ) : (
        <div className="rounded-lg border border-border bg-surface shadow-xs">
          <ResponsiveTable
            columns={scoreColumns}
            rows={scores}
            rowKey={(s) => s.partyId ?? "none"}
            caption="Vendor NCR scorecard"
            breakpoint="md"
            scrollRegionLabel="Vendor NCR scorecard"
            wrapperClassName="table-scroll"
            theadClassName="text-start text-xs text-muted"
            headRowClassName=""
            thClassName="px-3 py-2 font-medium"
            tdClassName="px-3 py-2"
            rowClassName="border-t border-border"
            cardClassName="px-4"
            cardTitle={(r) => <span className="font-medium text-ink">{r.partyId ? partyNames.get(r.partyId) ?? "Unknown party" : "No responsible party set"}</span>}
          />
        </div>
      )}
    </div>
  );
}
