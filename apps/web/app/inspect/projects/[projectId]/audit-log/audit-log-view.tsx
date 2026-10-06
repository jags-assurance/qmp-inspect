import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_LOG_TABLE, type AuditLogRow } from "@/lib/audit/types";
import { PageGuide } from "@/components/domain/page-guide";
import { DateRangeFilter } from "@/components/domain/date-range-filter";
import { parseDateRange, dateRangeToFromIso } from "@/lib/dates/date-range";

interface ProjectSummary {
  id: string;
  project_number: string;
  name: string;
  organizations: { name: string } | null;
}

interface AuditLogListRow extends Pick<AuditLogRow, "id" | "entity_type" | "entity_id" | "action" | "summary" | "created_at"> {
  actor_id: string | null;
  actor: { full_name: string; email: string } | null;
}

const RECORD_LINK: Record<string, (id: string, projectId: string) => string | null> = {
  ncr: (id) => `/inspect/ncrs/${id}`,
  itp: (id) => `/inspect/itps/${id}`,
  inspection_record: (id) => `/inspect/inspections/${id}`,
  data_book: (_id, projectId) => `/inspect/projects/${projectId}/data-book`,
  handover_certificate: () => "/inspect/handover",
};

function humanize(v: string): string {
  const t = v.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const AUDIT_PAGE = 50;

/**
 * R102: a reverse-chronological view of this project's audit_log rows, with category / person /
 * date-range filters and "Show more" pagination (50 per step). Staff-only: other roles get a
 * friendly explanation instead of a silent redirect.
 */
export async function AuditLogView({
  projectId,
  range,
  filters = {},
  embedded = false,
}: {
  projectId: string;
  range?: string;
  filters?: { cat?: string; actor?: string; limit?: string };
  embedded?: boolean;
}) {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        The audit log is an internal governance record and is only available to JAGS staff.{" "}
        <Link href={`/inspect/projects/${projectId}`} className="text-burgundy hover:underline">
          Back to the project
        </Link>
      </div>
    );
  }
  const limit = Math.min(1000, Math.max(AUDIT_PAGE, Number.parseInt(filters.limit ?? "", 10) || AUDIT_PAGE));

  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<ProjectSummary>();

  if (!project) notFound();

  const dateRange = parseDateRange(range);
  const fromIso = dateRangeToFromIso(dateRange);

  let query = supabase
    .from(AUDIT_LOG_TABLE)
    .select("id, entity_type, entity_id, action, summary, created_at, actor_id, actor:users(full_name, email)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (filters.cat) query = query.eq("entity_type", filters.cat);
  if (filters.actor) query = query.eq("actor_id", filters.actor);

  const { data: fetched } = await query.returns<AuditLogListRow[]>();
  const hasMore = (fetched ?? []).length > limit;
  const events = (fetched ?? []).slice(0, limit);

  // Filter options come from the project's own trail (distinct categories and people).
  const { data: facetRows } = await supabase
    .from(AUDIT_LOG_TABLE)
    .select("entity_type, actor_id, actor:users(full_name)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1000)
    .returns<{ entity_type: string; actor_id: string | null; actor: { full_name: string } | null }[]>();
  const categories = [...new Set((facetRows ?? []).map((r) => r.entity_type))].sort();
  const actors = [
    ...new Map(
      (facetRows ?? []).filter((r) => r.actor_id).map((r) => [r.actor_id as string, r.actor?.full_name ?? "Unknown"])
    ).entries(),
  ];
  const moreParams = new URLSearchParams();
  if (range) moreParams.set("range", range);
  if (filters.cat) moreParams.set("cat", filters.cat);
  if (filters.actor) moreParams.set("actor", filters.actor);
  moreParams.set("limit", String(limit + AUDIT_PAGE));

  const Heading = embedded ? "h2" : "h1";
  return (
    <div>
      {!embedded && (
        <Link href={`/inspect/projects/${projectId}`} className="text-sm text-burgundy hover:underline">
          ← Back to Project
        </Link>
      )}
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="text-2xl font-semibold text-ink">Audit Log</Heading>
          <PageGuide
            title="Audit Log — how this works"
            points={[
              "Staff-only — other logins see a short explanation instead of the log.",
              "A reverse-chronological list of every recorded create, edit, approval and status-change event on this project, 50 at a time (use Show more).",
              "Filter by category, person and date range. Category links open the underlying record where one exists.",
              "A row with no actor recorded (a system-triggered change) shows as \"System\".",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name ?? "—"} · <span className="doc-id">{project.project_number}</span> {project.name}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <DateRangeFilter />
          <p className="text-xs text-muted">
            Showing {fromIso ? `events since ${new Date(fromIso).toLocaleDateString("en-GB")}` : "all recorded events"}
            {hasMore ? ` (first ${limit}; use Show more)` : ""}
          </p>
        </div>
        {embedded ? (
          <p className="mt-2 text-xs text-muted">
            <Link href={`/inspect/projects/${projectId}/audit-log`} className="text-burgundy hover:underline">
              Open the full page
            </Link>{" "}
            to filter by category and person.
          </p>
        ) : (
          <form method="get" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
            {range && <input type="hidden" name="range" value={range} />}
            <select name="cat" defaultValue={filters.cat ?? ""} className="rounded-md border border-border bg-surface px-2 py-2 text-sm" aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
            <select name="actor" defaultValue={filters.actor ?? ""} className="rounded-md border border-border bg-surface px-2 py-2 text-sm" aria-label="Person">
              <option value="">Everyone</option>
              {actors.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white">
              Apply
            </button>
          </form>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        {events.length === 0 ? (
          <p className="text-sm text-muted">No audit events match. Try clearing the filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted">
                  <th className="py-2">Timestamp</th>
                  <th className="py-2">Actor</th>
                  <th className="py-2">Record</th>
                  <th className="py-2">Action</th>
                  <th className="py-2">Summary</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const href = RECORD_LINK[event.entity_type]?.(event.entity_id, projectId);
                  return (
                    <tr key={event.id} className="border-b border-border last:border-0 align-top">
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">
                        {new Date(event.created_at).toLocaleString("en-GB")}
                      </td>
                      <td className="py-2 pr-3">
                        {event.actor ? (
                          <span>
                            {event.actor.full_name}
                            <span className="ml-1 text-xs text-muted">({event.actor.email})</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted">System</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted">
                        {href ? (
                          <Link href={href} className="text-burgundy hover:underline">
                            {humanize(event.entity_type)}
                          </Link>
                        ) : (
                          humanize(event.entity_type)
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted">{humanize(event.action)}</td>
                      <td className="py-2 text-ink">{event.summary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div className="mt-4 text-center">
            <Link
              href={`/inspect/projects/${projectId}/audit-log?${moreParams.toString()}`}
              className="rounded-md border border-border px-4 py-2 text-sm text-burgundy"
            >
              Show more
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
