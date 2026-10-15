import { createSupabaseServerClient } from "@/lib/supabase/server";
import { T } from "@/components/domain/t";
import { Disclosure } from "@/components/ui/disclosure";

interface HistoryRow {
  review_round: number;
  reviewer_user_id: string | null;
  sort_order: number;
  status: string;
  reviewed_at: string | null;
  archived_reason: string | null;
  archived_at: string;
}

/**
 * S2-13: earlier review rounds of this ITP (who had approved what before it was returned to draft or restarted),
 * from itp_review_progress_history. Renders nothing when there is no history or the table is not migrated yet.
 */
export async function ReviewHistoryPanel({ itpId }: { itpId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("itp_review_progress_history" as never)
    .select("review_round, reviewer_user_id, sort_order, status, reviewed_at, archived_reason, archived_at")
    .eq("itp_id" as never, itpId as never)
    .order("review_round" as never, { ascending: false })
    .order("sort_order" as never)
    .returns<HistoryRow[]>();
  if (error || !data?.length) return null;

  const ids = [...new Set(data.map((r) => r.reviewer_user_id).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: users } = await supabase.from("users").select("id, full_name").in("id", ids).returns<{ id: string; full_name: string }[]>();
    for (const u of users ?? []) names.set(u.id, u.full_name);
  }

  const rounds = new Map<number, HistoryRow[]>();
  for (const row of data) rounds.set(row.review_round, [...(rounds.get(row.review_round) ?? []), row]);

  return (
    <Disclosure variant="pill" summary={<><T>Earlier review rounds</T></>} className="mt-4">
      <ul className="mt-2 space-y-2">
        {[...rounds.entries()].map(([round, rows]) => (
          <li key={round}>
            <details className="rounded-md border border-border">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm">
                <span className="font-medium text-ink"><T>Round</T> {round}</span>{" "}
                <span className="text-muted">
                  <T>— archived</T> {new Date(rows[0].archived_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  {rows[0].archived_reason ? ` · ${rows[0].archived_reason}` : ""}
                </span>
              </summary>
              <ol className="border-t border-border px-3 py-2 text-xs text-muted">
                {rows.map((r) => (
                  <li key={`${round}-${r.sort_order}`}>
                    {r.sort_order}. {(r.reviewer_user_id && names.get(r.reviewer_user_id)) || "Reviewer"} —{" "}
                    {r.status === "approved"
                      ? `approved${r.reviewed_at ? ` ${new Date(r.reviewed_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}`
                      : "had not reviewed yet"}
                  </li>
                ))}
              </ol>
            </details>
          </li>
        ))}
      </ul>
</Disclosure>
  );
}
