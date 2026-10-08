import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateOnly, formatSiteDateTime } from "@/lib/ncrs/site-date";
import { summariseWalkdown } from "@/lib/punch-list/walkdown";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { PrintButton } from "./print-button";

interface Walkdown {
  id: string;
  walkdown_number: string | null;
  walked_on: string;
  area: string | null;
  attendees: string | null;
  notes: string | null;
  item_count: number;
  signed_off_at: string | null;
  created_by_user: { full_name: string } | null;
  signed_off_by_user: { full_name: string } | null;
}

interface Item {
  id: string;
  description: string;
  status: string;
  priority: string | null;
  location: string | null;
  due_date: string | null;
  withdrawn_at: string | null;
  project_parties: { name: string } | null;
}

/** Printable walkdown record (use the browser's Print / Save as PDF): header, attendees, items, sign-off. */
export default async function WalkdownReportPage({ params }: { params: Promise<{ projectId: string; walkdownId: string }> }) {
  const { projectId, walkdownId } = await params;
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: wd, error } = await supabase
    .from("walkdowns" as never)
    .select(
      "id, walkdown_number, walked_on, area, attendees, notes, item_count, signed_off_at, created_by_user:users!walkdowns_created_by_fkey(full_name), signed_off_by_user:users!walkdowns_signed_off_by_fkey(full_name)"
    )
    .eq("id", walkdownId)
    .eq("project_id", projectId)
    .maybeSingle<Walkdown>();
  if (error || !wd) notFound();

  const { data: items } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("id, description, status, priority, location, due_date, withdrawn_at, project_parties:responsible_party_id(name)")
    .eq("walkdown_id", walkdownId)
    .order("created_at")
    .returns<Item[]>();
  const rows = items ?? [];
  const summary = summariseWalkdown(rows);

  return (
    <div className="print-area max-w-4xl">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/inspect/projects/${projectId}/punch-list`} className="text-sm text-burgundy hover:underline">
          ← Back to punch list
        </Link>
        <PrintButton />
      </div>
      <h1 className="mt-3 text-2xl font-semibold text-ink">Walkdown record{wd.walkdown_number ? ` ${wd.walkdown_number}` : ""}</h1>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-muted">Date: </dt><dd className="inline text-ink">{formatDateOnly(wd.walked_on)}</dd></div>
        <div><dt className="inline text-muted">Area: </dt><dd className="inline text-ink">{wd.area || "-"}</dd></div>
        <div><dt className="inline text-muted">Recorded by: </dt><dd className="inline text-ink">{wd.created_by_user?.full_name ?? "-"}</dd></div>
        <div><dt className="inline text-muted">Attendees: </dt><dd className="inline text-ink">{wd.attendees || "-"}</dd></div>
      </dl>
      {wd.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{wd.notes}</p>}
      <p className="mt-3 text-sm text-muted">
        {summary.total} item{summary.total === 1 ? "" : "s"}: {summary.open} open, {summary.resolved} resolved, {summary.closed} closed.
        {Object.keys(summary.byPriority).length > 0 && ` Priority ${Object.entries(summary.byPriority).sort().map(([p, n]) => `${p}: ${n}`).join(", ")}.`}
      </p>

      <div className="overflow-x-auto"><table className="mt-3 w-full text-sm">
        <thead className="text-start text-xs text-muted">
          <tr>
            <th className="py-1 pe-2">#</th>
            <th className="py-1 pe-2">Description</th>
            <th className="py-1 pe-2">Location</th>
            <th className="py-1 pe-2">Responsible</th>
            <th className="py-1 pe-2">Priority</th>
            <th className="py-1 pe-2">Due</th>
            <th className="py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="py-1 pe-2">{i + 1}</td>
              <td className="py-1 pe-2 text-ink">{r.description}</td>
              <td className="py-1 pe-2">{r.location ?? "-"}</td>
              <td className="py-1 pe-2">{r.project_parties?.name ?? "-"}</td>
              <td className="py-1 pe-2">{r.priority ?? "-"}</td>
              <td className="py-1 pe-2">{r.due_date ? formatDateOnly(r.due_date) : "-"}</td>
              <td className="py-1">{r.withdrawn_at ? "withdrawn" : r.status}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <div className="mt-8 border-t border-border pt-3 text-sm">
        {wd.signed_off_at ? (
          <p className="text-ink">
            Signed off by {wd.signed_off_by_user?.full_name ?? "the recorder"} on {formatSiteDateTime(wd.signed_off_at)}.
          </p>
        ) : (
          <p className="text-muted">Not signed off yet.</p>
        )}
      </div>
    </div>
  );
}
