import Link from "next/link";
import { ViewHeader } from "@/components/domain/view-header";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_LOG_TABLE, type AuditLogRow } from "@/lib/audit/types";
import { loadAuditFacets } from "@/lib/audit/facets";
import { PageGuide } from "@/components/domain/page-guide";
import { DateRangeFilter } from "@/components/domain/date-range-filter";
import { parseDateRange, dateRangeToFromIso } from "@/lib/dates/date-range";
import { getLatestAuditTrailPdf } from "@/lib/reports/actions";
import { AuditTrailPdfButton } from "./audit-trail-pdf-button";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { Button, buttonVariants } from "@/components/ui/button";

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
  const tl = await getTranslator();
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted">
        <T>The audit log is an internal governance record and is only available to JAGS staff.</T>{" "}
        <Link href={`/inspect/projects/${projectId}`} className="text-burgundy hover:underline">
          <T>Back to the project</T>
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

  // Filter options: distinct categories and people across the project's WHOLE trail (SQL DISTINCT).
  const { categories, actors } = await loadAuditFacets(supabase, projectId, async () => {
    const { data: facetRows } = await supabase
      .from(AUDIT_LOG_TABLE)
      .select("entity_type, actor_id, actor:users(full_name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1000)
      .returns<{ entity_type: string; actor_id: string | null; actor: { full_name: string } | null }[]>();
    return facetRows ?? [];
  });
  const moreParams = new URLSearchParams();
  if (range) moreParams.set("range", range);
  if (filters.cat) moreParams.set("cat", filters.cat);
  if (filters.actor) moreParams.set("actor", filters.actor);
  moreParams.set("limit", String(limit + AUDIT_PAGE));

  const latestPdf = await getLatestAuditTrailPdf(projectId);
  const exportParams = new URLSearchParams();
  if (range) exportParams.set("range", range);
  if (filters.cat) exportParams.set("cat", filters.cat);
  if (filters.actor) exportParams.set("actor", filters.actor);
  const csvHref = `/inspect/projects/${projectId}/audit-log/export${exportParams.size ? `?${exportParams.toString()}` : ""}`;

  const auditColumns: ResponsiveColumn<(typeof events)[number]>[] = [
    {
      key: "timestamp",
      header: "Timestamp",
      className: "whitespace-nowrap text-xs text-muted",
      render: (event) => new Date(event.created_at).toLocaleString("en-GB"),
    },
    {
      key: "actor",
      header: "Actor",
      render: (event) =>
        event.actor ? (
          <span>
            {event.actor.full_name}
            <span className="ms-1 text-xs text-muted">({event.actor.email})</span>
          </span>
        ) : (
          <span className="text-xs text-muted"><T>System</T></span>
        ),
    },
    {
      key: "record",
      header: "Record",
      className: "text-xs text-muted",
      render: (event) => {
        const href = RECORD_LINK[event.entity_type]?.(event.entity_id, projectId);
        return href ? (
          <Link href={href} className="text-burgundy hover:underline">
            {humanize(event.entity_type)}
          </Link>
        ) : (
          humanize(event.entity_type)
        );
      },
    },
    { key: "action", header: "Action", className: "text-xs text-muted", render: (event) => humanize(event.action) },
    { key: "summary", header: "Summary", className: "text-ink", render: (event) => event.summary },
  ];

  return (
    <div>
      <ViewHeader
        embedded={embedded}
        backHref={`/inspect/projects/${projectId}`}
        title={<T>Audit Log</T>}
        guide={
          <PageGuide
            title={tl("Audit Log — how this works")}
            points={[
              "Staff-only — other logins see a short explanation instead of the log.",
              "A reverse-chronological list of every recorded create, edit, approval and status-change event on this project, 50 at a time (use Show more).",
              "Filter by category, person and date range. Category links open the underlying record where one exists.",
              "A row with no actor recorded (a system-triggered change) shows as \"System\".",
            ]}
          />
        }
        subtitle={<>{project.organizations?.name ?? "—"} · <span className="doc-id">{project.project_number}</span> {project.name}</>}
      />
      <div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <DateRangeFilter />
          <p className="text-xs text-muted">
            <T>Showing</T> {fromIso ? `events since ${new Date(fromIso).toLocaleDateString("en-GB")}` : "all recorded events"}
            {hasMore ? ` (first ${limit}; use Show more)` : ""}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-surface p-3">
          <p className="max-w-md text-xs text-muted">
            <T>Export this view</T>{filters.cat || filters.actor ? " with the current filters" : ""}<T>. The CSV contains every matching event, not just the rows shown; the PDF lists up to 5,000. Exports are recorded in this log.</T>
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <a href={csvHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <T>Export CSV ↓</T>
            </a>
            <AuditTrailPdfButton projectId={projectId} range={range} cat={filters.cat} actor={filters.actor} latest={latestPdf} />
          </div>
        </div>
        {embedded ? (
          <p className="mt-2 text-xs text-muted">
            <Link href={`/inspect/projects/${projectId}/audit-log`} className="text-burgundy hover:underline">
              <T>Open the full page</T>
            </Link>{" "}
            <T>to filter by category and person.</T>
          </p>
        ) : (
          <form method="get" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
            {range && <input type="hidden" name="range" value={range} />}
            <select name="cat" defaultValue={filters.cat ?? ""} className="rounded-md border border-border bg-surface px-2 py-2 text-sm" aria-label={tl("Category")}>
              <option value=""><T>All categories</T></option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </select>
            <select name="actor" defaultValue={filters.actor ?? ""} className="rounded-md border border-border bg-surface px-2 py-2 text-sm" aria-label={tl("Person")}>
              <option value=""><T>Everyone</T></option>
              {actors.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <Button type="submit" >
              <T>Apply</T>
            </Button>
          </form>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        {events.length === 0 ? (
          <p className="text-sm text-muted"><T>No audit events match. Try clearing the filters.</T></p>
        ) : (
          <ResponsiveTable
            columns={auditColumns}
            rows={events}
            rowKey={(event) => event.id}
            caption="Audit log events"
            headRowClassName="border-b border-border text-start text-xs uppercase text-muted"
            thClassName="py-2"
            tdClassName="py-2 pe-3"
            rowClassName="border-b border-border last:border-0 align-top"
          />
        )}
        {hasMore && (
          <div className="mt-4 text-center">
            <Link
              href={`/inspect/projects/${projectId}/audit-log?${moreParams.toString()}`}
              className="rounded-md border border-border px-4 py-2 text-sm text-burgundy"
            >
              <T>Show more</T>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
