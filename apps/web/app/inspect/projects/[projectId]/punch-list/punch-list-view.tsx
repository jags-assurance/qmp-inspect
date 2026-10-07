import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { AddPunchItemForm } from "./add-punch-item-form";
import { RecordWalkdownForm } from "./record-walkdown-form";
import { WalkdownsPanel } from "./walkdowns-panel";
import { PunchListTable, type PunchListItemDisplayRow } from "./punch-list-table";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";
import { userNames } from "@/lib/ncrs/recipients";

type RawPunchRow = Omit<PunchListItemDisplayRow, "photo_urls" | "closing_photo_urls" | "resolved_by_name" | "closed_by_name">;

export async function PunchListView({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
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
      .select("id, description, source, location, due_date, status, closing_evidence, verification_notes, priority, photo_paths, closing_photo_paths, reopen_reason, reopen_count, responsible_party_id, source_ncr_id, source_inspection_record_id, source_standalone_assignment_id, resolved_by, resolved_at, closed_by, closed_at, project_parties(name, user_id)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .returns<RawPunchRow[]>(),
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

  // ONE batched call signs every photo path of every item (bucket is private), then maps back.
  const allPaths = [...new Set((items ?? []).flatMap((i) => [...(i.photo_paths ?? []), ...(i.closing_photo_paths ?? [])]))];
  const urlByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("inspection-evidence").createSignedUrls(allPaths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  const urlsFor = (paths: string[] | null) => (paths ?? []).map((p) => urlByPath.get(p)).filter((u): u is string => !!u);

  // Resolver / verifier names in one query.
  const userIds = [...new Set((items ?? []).flatMap((i) => [i.resolved_by, i.closed_by]).filter((u): u is string => !!u))];
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    for (const [id, name] of await userNames(supabase, userIds)) nameById.set(id, name);
  }

  const rows: PunchListItemDisplayRow[] = (items ?? []).map((item) => ({
    ...item,
    photo_urls: urlsFor(item.photo_paths),
    closing_photo_urls: urlsFor(item.closing_photo_paths),
    resolved_by_name: item.resolved_by ? nameById.get(item.resolved_by) ?? null : null,
    closed_by_name: item.closed_by ? nameById.get(item.closed_by) ?? null : null,
  }));

  const resolvedCount = rows.filter((item) => item.status === "resolved").length;
  const reallyOpenCount = rows.filter((item) => item.status === "open").length;

  const Heading = embedded ? "h2" : "h1";
  return (
    <div>
      <RealtimeRefresh table="punch_list_items" filter={`project_id=eq.${projectId}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Heading className="doc-id text-2xl font-semibold text-ink">{embedded ? "Punch list" : `${project.project_number} — Punch List`}</Heading>
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

      {openCount > 0 ? (
        <div role="status" className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
          <strong>Data Book blocked:</strong> {reallyOpenCount} open and {resolvedCount} resolved-but-unverified item
          {openCount === 1 ? "" : "s"} must be closed (verified) before the Data Book can compile.{" "}
          <Link href={`/inspect/projects/${projectId}/data-book`} className="font-medium text-burgundy hover:underline">
            Open Data Book
          </Link>
        </div>
      ) : (
        <p role="status" className="mt-4 rounded-md border border-border bg-off-white px-3 py-2 text-sm text-muted">
          No outstanding punch items - this no longer blocks the Data Book.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-start gap-3">
        <AddPunchItemForm projectId={projectId} projectParties={projectParties ?? []} />
        <RecordWalkdownForm projectId={projectId} projectParties={projectParties ?? []} />
      </div>

      <WalkdownsPanel projectId={projectId} />

      <div className="mt-6">
        <PunchListTable
          projectId={projectId}
          rows={rows}
          canVerifyClose={canVerifyClose}
          currentUserId={session.userId}
          projectParties={projectParties ?? []}
          exportName={`${project.project_number}-punch-list`}
        />
      </div>
    </div>
  );
}
