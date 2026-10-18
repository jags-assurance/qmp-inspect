import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

/**
 * Compact in-workspace lists for the three registers that are global pages elsewhere (NCRs,
 * Observations, ITPs): the project's own records, most recent first, so you can see and jump into
 * them without leaving the project window. The full register (search, paging, export) is one link
 * away. Rows are single links with wrapping text so they stay readable at phone width.
 */

const LIMIT = 25;

function ListShell({ title, hint, fullHref, fullLabel, children, empty }: { title: string; hint: string; fullHref: string; fullLabel: string; children: React.ReactNode; empty: boolean }) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="text-sm text-muted">{hint}</p>
        </div>
        <Link href={fullHref} className="inline-flex min-h-11 items-center text-sm font-medium text-burgundy hover:underline">
          {fullLabel} →
        </Link>
      </div>
      {empty ? (
        <p className="mt-3 rounded-md bg-off-white px-3 py-4 text-sm text-muted"><T>Nothing here yet.</T></p>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">{children}</ul>
      )}
    </section>
  );
}

const rowClass = "flex min-h-14 flex-col gap-1 px-3 py-2 hover:bg-surface-subtle sm:flex-row sm:items-center sm:gap-3";

const NCR_TONE = { major_ncr: "danger", minor_ncr: "gold", observation: "info" } as const;
const NCR_LABEL = { major_ncr: "Major", minor_ncr: "Minor", observation: "Observation" } as const;

async function loadNcrs(projectId: string, observations: boolean) {
  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("ncrs" as never)
    .select("id, ncr_number, severity, status, description, due_date, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  q = observations ? q.eq("severity", "observation") : q.neq("severity", "observation");
  const { data } = await q.returns<
    { id: string; ncr_number: string; severity: keyof typeof NCR_TONE; status: string; description: string; due_date: string | null }[]
  >();
  return data ?? [];
}

export async function NcrsTabView({ projectId, observations = false }: { projectId: string; observations?: boolean }) {
  const rows = await loadNcrs(projectId, observations);
  return (
    <ListShell
      title={observations ? "Observations" : "NCRs"}
      hint={observations ? "Lighter findings, gradeable up to an NCR." : "Minor and major non-conformances on this project."}
      fullHref={`/inspect/${observations ? "observations" : "ncrs"}?project=${projectId}`}
      fullLabel={observations ? "Open the Observation Register" : "Open the NCR Register"}
      empty={rows.length === 0}
    >
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/inspect/ncrs/${r.id}`} className={rowClass}>
            <span className="flex items-center gap-2 sm:w-52 sm:shrink-0">
              <Badge tone={NCR_TONE[r.severity] ?? "neutral"}>{NCR_LABEL[r.severity] ?? r.severity}</Badge>
              <span className="doc-id text-sm text-burgundy">{r.ncr_number}</span>
            </span>
            <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{r.description}</span>
            <span className="text-xs text-muted sm:shrink-0">
              <span className="capitalize">{r.status.replace(/_/g, " ")}</span>
              {r.due_date && <> <T>· due</T> {new Date(r.due_date).toLocaleDateString("en-GB")}</>}
            </span>
          </Link>
        </li>
      ))}
    </ListShell>
  );
}

export async function ItpsTabView({ projectId }: { projectId: string }) {
  const tl = await getTranslator();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("itps")
    .select("id, itp_number, title, status, revision")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(LIMIT)
    .returns<{ id: string; itp_number: string; title: string; status: string; revision: string | number | null }[]>();
  const rows = data ?? [];
  return (
    <ListShell
      title={tl("ITPs")}
      hint="Inspection & Test Plans on this project."
      fullHref={`/inspect/itps?project=${projectId}`}
      fullLabel="Open the ITP Register"
      empty={rows.length === 0}
    >
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/inspect/itps/${r.id}`} className={rowClass}>
            <span className="doc-id text-sm text-burgundy sm:w-52 sm:shrink-0">{r.itp_number}</span>
            <span className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">{r.title}</span>
            <span className="text-xs capitalize text-muted sm:shrink-0">
              {r.status.replace(/_/g, " ")}
              {r.revision !== null && r.revision !== "" ? ` · rev ${r.revision}` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ListShell>
  );
}
