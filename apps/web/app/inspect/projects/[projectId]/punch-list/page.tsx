import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { AddPunchItemForm } from "./add-punch-item-form";
import { RecordWalkdownForm } from "./record-walkdown-form";
import { PunchListTable, type PunchListItemDisplayRow } from "./punch-list-table";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";

export default async function PunchListPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireSession();
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
      .select("id, description, source, location, due_date, status, project_parties(name)")
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

  const openCount = (items ?? []).filter((item) => item.status === "open").length;

  return (
    <div>
      <RealtimeRefresh table="punch_list_items" filter={`project_id=eq.${projectId}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="doc-id text-2xl font-semibold text-ink">{project.project_number} — Punch List</h1>
          <p className="mt-1 text-sm text-muted">
            {project.organizations?.name} · {project.name}. {openCount} open item{openCount === 1 ? "" : "s"}{" "}
            outstanding before this project's Data Book can compile without an override.
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
        <PunchListTable projectId={projectId} rows={items ?? []} />
      </div>
    </div>
  );
}
