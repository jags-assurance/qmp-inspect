import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { AddPunchItemForm } from "./add-punch-item-form";
import { RecordWalkdownForm } from "./record-walkdown-form";
import { PunchListTable, type PunchListItemDisplayRow } from "./punch-list-table";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";

export default async function PunchListPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await requireSession();
  const canVerifyClose = isAdminStaff(session) || (await hasPermission(session.userId, "close_punch_item", projectId));
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, project_number, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{ id: string; name: string; project_number: string; organizations: { name: string } | null }>();

  if (!project) notFound();

  const [{ data: items }, { data: projectParties }] = await Promise.all([
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, description, source, location, due_date, status, closing_evidence, project_parties(name, user_id)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .returns<PunchListItemDisplayRow[]>(),
    supabase
      .from("project_parties")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("name"),
  ]);

  // "Outstanding" for the Data Book blurb below means not yet truly closed — a 'resolved' item still
  // blocks compilation until someone independently verifies it (see readiness.ts's matching count).
  const openCount = (items ?? []).filter((item) => item.status !== "closed").length;

  return (
    <div>
      <RealtimeRefresh table="punch_list_items" filter={`project_id=eq.${projectId}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="doc-id text-2xl font-semibold text-ink">{project.project_number} — Punch List</h1>
            <PageGuide
              title="Punch List — how this works"
              points={[
                "Outstanding items across every source (NCRs, observations, walkdowns, manually added) — open, resolved and closed, all in one list.",
                "Two-step close, not a bare status flip: anyone with project access can mark an item Resolved (evidence of the fix required) — then a JAGS Admin, or someone specifically granted permission, independently verifies and closes it.",
                "The project's Data Book can't compile while any item here is open OR resolved-but-not-yet-verified, unless a JAGS staff member explicitly overrides it with a documented reason on the Data Book page.",
                "\"Record walkdown\" adds several items at once from a single site walkdown, rather than one at a time through the add form.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {project.organizations?.name} · {project.name}. {openCount} open item{openCount === 1 ? "" : "s"}{" "}
            outstanding before this project&apos;s Data Book can compile without an override.
          </p>
        </div>
        <Link
          href={`/inspect/projects/${projectId}/guide`}
          className="shrink-0 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-off-white"
        >
          ? Project Guide
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-3">
        <AddPunchItemForm projectId={projectId} projectParties={projectParties ?? []} />
        <RecordWalkdownForm projectId={projectId} projectParties={projectParties ?? []} />
      </div>

      <div className="mt-6">
        <PunchListTable projectId={projectId} rows={items ?? []} canVerifyClose={canVerifyClose} currentUserId={session.userId} />
      </div>
    </div>
  );
}
