import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { siteToday } from "@/lib/ncrs/site-date";
import { buildVendorScorecard, type ScorecardNcr } from "@/lib/ncrs/scorecard";

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

  const scores = buildVendorScorecard(rows, siteToday());
  const num = "px-3 py-2 text-right tabular-nums";

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
        <div className="table-scroll mt-4 rounded-lg border border-border bg-surface" tabIndex={0} role="region" aria-label="Vendor NCR scorecard">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Responsible party</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Open</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Overdue</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Major</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Minor</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Re-opened</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Avg days to close</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Closed on time</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.partyId ?? "none"} className="border-t border-border">
                  <td className="px-3 py-2 text-ink">{s.partyId ? partyNames.get(s.partyId) ?? "Unknown party" : "No responsible party set"}</td>
                  <td className={num}>{s.total}</td>
                  <td className={num}>{s.open}</td>
                  <td className={`${num} ${s.overdue > 0 ? "font-medium text-danger" : ""}`}>{s.overdue}</td>
                  <td className={num}>{s.major}</td>
                  <td className={num}>{s.minor}</td>
                  <td className={num}>{s.reopened}</td>
                  <td className={num}>{s.avgDaysToClose ?? "—"}</td>
                  <td className={num}>{s.onTimeRate == null ? "—" : `${s.onTimeRate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
