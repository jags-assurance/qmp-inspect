import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUDIT_LOG_TABLE, type AuditLogRow } from "@/lib/audit/types";
import { PageGuide } from "@/components/domain/page-guide";
import { DateRangeFilter, parseDateRange, dateRangeToFromIso } from "@/components/domain/date-range-filter";

interface ProjectSummary {
  id: string;
  project_number: string;
  name: string;
  organizations: { name: string } | null;
}

interface AuditLogListRow extends Pick<AuditLogRow, "id" | "entity_type" | "entity_id" | "action" | "summary" | "created_at"> {
  actor: { full_name: string; email: string } | null;
}

/**
 * R102: a plain reverse-chronological view of this project's audit_log rows — the general trail
 * every create/edit/approval/status-change event on the project now feeds (see lib/audit/log.ts and
 * its call sites). Staff-only, same as the app's other admin-facing register/config pages: this is
 * an internal governance view, not something a client or contractor party needs day to day.
 */
export default async function ProjectAuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await requireSession();
  const { projectId } = await params;
  if (!session.isJagsStaff) redirect(`/inspect/projects/${projectId}`);

  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<ProjectSummary>();

  if (!project) notFound();

  const { range } = await searchParams;
  const dateRange = parseDateRange(range);
  const fromIso = dateRangeToFromIso(dateRange);

  let query = supabase
    .from(AUDIT_LOG_TABLE)
    .select("id, entity_type, entity_id, action, summary, created_at, actor:users(full_name, email)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (fromIso) query = query.gte("created_at", fromIso);

  const { data: events } = await query.returns<AuditLogListRow[]>();

  return (
    <div>
      <Link href={`/inspect/projects/${projectId}`} className="text-sm text-burgundy hover:underline">
        ← Back to Project
      </Link>
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink">Audit Log</h1>
          <PageGuide
            title="Audit Log — how this works"
            points={[
              "Staff-only — the page redirects any non-JAGS-staff login back to the project hub. This is an internal governance view, not something a client or contractor party sees.",
              "A plain reverse-chronological list of audit_log rows: every recorded create, edit, approval and status-change event on this project, newest first, capped to the most recent 200.",
              "The actor shown is whoever performed the action; a row with no actor recorded (a system-triggered change) shows as \"System\".",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name ?? "—"} · <span className="doc-id">{project.project_number}</span> {project.name}
        </p>
        <p className="mt-1 text-sm text-muted">
          Every recorded create, edit, approval and status-change event on this project, newest first.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <DateRangeFilter />
          <p className="text-xs text-muted">
            Showing {fromIso ? `events since ${new Date(fromIso).toLocaleDateString("en-GB")}` : "all recorded events"}
            {(events ?? []).length >= 200 ? " (capped to the most recent 200)" : ""}
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        {(events ?? []).length === 0 ? (
          <p className="text-sm text-muted">No audit events recorded for this project yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted">
                <th className="py-2">Timestamp</th>
                <th className="py-2">Actor</th>
                <th className="py-2">Entity</th>
                <th className="py-2">Action</th>
                <th className="py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).map((event) => (
                <tr key={event.id} className="border-b border-border last:border-0 align-top">
                  <td className="whitespace-nowrap py-2 text-xs text-muted">
                    {new Date(event.created_at).toLocaleString("en-GB")}
                  </td>
                  <td className="py-2">
                    {event.actor ? (
                      <span>
                        {event.actor.full_name}
                        <span className="ml-1 text-xs text-muted">({event.actor.email})</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">System</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-muted">{event.entity_type}</td>
                  <td className="py-2 text-xs text-muted">{event.action}</td>
                  <td className="py-2 text-ink">{event.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
