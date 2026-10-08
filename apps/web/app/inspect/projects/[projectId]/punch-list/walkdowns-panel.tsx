import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { formatDateOnly, formatSiteDateTime } from "@/lib/ncrs/site-date";
import { SignOffWalkdownButton } from "./signoff-walkdown-button";
import { T } from "@/components/domain/t";

interface WalkdownRow {
  id: string;
  walkdown_number: string | null;
  walked_on: string;
  area: string | null;
  item_count: number;
  created_by: string | null;
  signed_off_at: string | null;
}

/** Recent walkdowns with sign-off and a printable report (S5-23). Renders nothing before the walkdowns migration. */
export async function WalkdownsPanel({ projectId }: { projectId: string }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("walkdowns" as never)
    .select("id, walkdown_number, walked_on, area, item_count, created_by, signed_off_at")
    .eq("project_id", projectId)
    .order("walked_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(8)
    .returns<WalkdownRow[]>();
  if (error || !data || data.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-medium text-ink"><T>Recent walkdowns</T></h2>
      <ul className="mt-2 divide-y divide-border text-sm">
        {data.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <span className="font-medium text-ink">{w.area || "Walkdown"}</span>{" "}
              <span className="text-muted">
                {formatDateOnly(w.walked_on)} · {w.item_count} <T>item</T>{w.item_count === 1 ? "" : "s"}
              </span>
              {w.signed_off_at && <span className="ms-2 text-xs text-success"><T>Signed off</T> {formatSiteDateTime(w.signed_off_at)}</span>}
            </div>
            <div className="flex items-center gap-3">
              <Link href={`/inspect/projects/${projectId}/punch-list/walkdowns/${w.id}`} className="text-xs font-medium text-burgundy hover:underline">
                <T>Report</T>
              </Link>
              {!w.signed_off_at && (w.created_by === session.userId || isAdminStaff(session)) && (
                <SignOffWalkdownButton projectId={projectId} walkdownId={w.id} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
