import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { PageGuide } from "@/components/domain/page-guide";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE } from "@/lib/signoff/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { CHECKLIST_TEMPLATES_TABLE, INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import { ScanSearchInput } from "./scan-search-input";
import { SaveOfflineButton } from "./save-offline-button";
import { loadArchivedTemplateIds } from "@/lib/checklists/archived-templates";
import { filterByArchive, parseArchiveFilter } from "@/lib/checklists/template-ui-logic";
import { loadAssignedToMe } from "@/lib/checklists/assigned-queries";
import { AssignedToMe } from "@/components/domain/assigned-to-me";
import { filterAssignedToMe, parseAssignedFilter } from "@/lib/checklists/assignment-logic";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { withActiveProject } from "@/lib/projects/active-project";
import { getActiveProjectId } from "@/lib/projects/active-project-server";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/toolbar";
import { FILTER_CONTROL_CLASS } from "@/components/ui/filter-styles";

type StatusKey = "not_started" | "in_progress" | "completed";
const STATUS_LABEL: Record<StatusKey, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

interface TemplateRow {
  id: string;
  checklist_number: string;
  itp_item_id: string;
  itp_items: {
    id: string;
    item_number: string;
    activity: string;
    planned_date: string | null;
    assigned_to_user_id?: string | null;
    itp_sections: { itps: { id: string; itp_number: string; status: string; projects: { id: string; name: string; organization_id: string; enforce_hold_blocks_start: boolean } | null } | null } | null;
  } | null;
}

export default async function StartWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; project?: string; due?: string; archived?: string; assigned?: string }>;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect");
  const sp = withActiveProject(await searchParams, await getActiveProjectId());
  const q = (sp.q ?? "").trim().toLowerCase();
  const statusFilter = (["not_started", "in_progress", "completed"] as const).find((k) => k === sp.status) ?? "";
  const projectFilter = sp.project ?? "";
  const dueFilter = (["overdue", "soon", "held"] as const).find((k) => k === sp.due) ?? "";

  const archiveFilter = parseArchiveFilter(sp.archived);
  const assignedFilter = parseAssignedFilter(sp.assigned);

  const supabase = await createSupabaseServerClient();
  // Independent of everything below, so it starts now (it reuses the cached archived-id read).
  const assignedQueuePromise = loadAssignedToMe(supabase, session.userId);
  const archivedIds = await loadArchivedTemplateIds(supabase);
  const templateSelect = (withAssignee: boolean) =>
    `id, checklist_number, itp_item_id, itp_items(id, item_number, activity, planned_date, ${withAssignee ? "assigned_to_user_id, " : ""}itp_sections(itps(id, itp_number, status, projects(id, name, organization_id, enforce_hold_blocks_start))))`;
  const [firstTemplates, { data: records }] = await Promise.all([
    supabase.from(CHECKLIST_TEMPLATES_TABLE).select(templateSelect(true)).limit(1000).returns<TemplateRow[]>(),
    supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("itp_item_id, checklist_template_id, overall_result")
      .limit(5000)
      .returns<{ itp_item_id: string; checklist_template_id: string; overall_result: string | null }[]>(),
  ]);
  // Until 20261114000101 is applied the assignee column does not exist: retry without it so the page still loads.
  let allTemplates = firstTemplates.data;
  if (firstTemplates.error) {
    allTemplates = (await supabase.from(CHECKLIST_TEMPLATES_TABLE).select(templateSelect(false)).limit(1000).returns<TemplateRow[]>()).data;
  }

  // Archived checklists are hidden from start-work unless the Archived filter is on.
  const templates = filterByArchive(allTemplates ?? [], archivedIds, archiveFilter);

  const stateByTemplate = new Map<string, StatusKey>();
  for (const r of records ?? []) {
    const cur = stateByTemplate.get(r.checklist_template_id);
    if (r.overall_result === null) stateByTemplate.set(r.checklist_template_id, "in_progress");
    else if (cur !== "in_progress") stateByTemplate.set(r.checklist_template_id, "completed");
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const soonDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  const soonStr = `${soonDate.getFullYear()}-${String(soonDate.getMonth() + 1).padStart(2, "0")}-${String(soonDate.getDate()).padStart(2, "0")}`;

  // ONE batched query for "awaiting hold release": pending/notified sign-off rows for the shown
  // activities, intersected with the organisation's blocking level codes (one more small query).
  const itemIds = [...new Set((templates ?? []).map((t) => t.itp_item_id))];
  // A level assigned on the grid with no progress row yet still holds (same rule as
  // canCompleteInspection, which the checklist page uses): without it an activity showed as ready
  // here but its checklist then refused to start.
  type ProgressRow = { itp_item_id: string; project_party_id: string; intervention: string; status: string };
  type AssignedRow = { itp_item_id: string; project_party_id: string; intervention: string };
  const [{ data: progressRows }, { data: assignedRows }, { data: blockingLevels }] = await Promise.all([
    itemIds.length
      ? supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("itp_item_id, project_party_id, intervention, status")
          .in("itp_item_id", itemIds)
          .limit(10000)
          .returns<ProgressRow[]>()
      : Promise.resolve({ data: [] as ProgressRow[] }),
    itemIds.length
      ? supabase
          .from("activity_party_intervention")
          .select("itp_item_id, project_party_id, intervention")
          .in("itp_item_id", itemIds)
          .limit(10000)
          .returns<AssignedRow[]>()
      : Promise.resolve({ data: [] as AssignedRow[] }),
    supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("organization_id, code")
      .eq("is_blocking", true)
      .returns<{ organization_id: string; code: string }[]>(),
  ]);
  const blockingKeys = new Set((blockingLevels ?? []).map((l) => `${l.organization_id}:${l.code}`));
  const signedOff = new Set(
    (progressRows ?? []).filter((r) => r.status === "signed_off").map((r) => `${r.itp_item_id}:${r.project_party_id}:${r.intervention}`)
  );
  const openByItem = new Map<string, string[]>();
  for (const r of [...(progressRows ?? []), ...(assignedRows ?? [])]) {
    if (signedOff.has(`${r.itp_item_id}:${r.project_party_id}:${r.intervention}`)) continue;
    openByItem.set(r.itp_item_id, [...(openByItem.get(r.itp_item_id) ?? []), r.intervention]);
  }

  const activities = (templates ?? [])
    .filter((t) => {
      const st = t.itp_items?.itp_sections?.itps?.status;
      return t.itp_items && (st === "approved" || st === "client_accepted");
    })
    .map((t) => ({
      templateId: t.id,
      checklistNumber: t.checklist_number,
      itemNumber: t.itp_items!.item_number,
      activity: t.itp_items!.activity,
      itpNumber: t.itp_items!.itp_sections!.itps!.itp_number,
      projectId: t.itp_items!.itp_sections!.itps!.projects?.id ?? "",
      projectName: t.itp_items!.itp_sections!.itps!.projects?.name ?? "—",
      plannedDate: t.itp_items!.planned_date,
      assignedToUserId: t.itp_items!.assigned_to_user_id ?? null,
      awaitingHold: (openByItem.get(t.itp_item_id) ?? []).some((code) =>
        blockingKeys.has(`${t.itp_items!.itp_sections!.itps!.projects?.organization_id ?? ""}:${code}`)
      ),
      status: stateByTemplate.get(t.id) ?? ("not_started" as StatusKey),
    }));
  const projectOptions = [...new Map(activities.map((a) => [a.projectId, a.projectName])).entries()];
  const rank: Record<StatusKey, number> = { in_progress: 0, not_started: 1, completed: 2 };
  const withFlags = activities.map((a) => ({
    ...a,
    overdue: !!a.plannedDate && a.plannedDate < todayStr && a.status !== "completed",
    dueSoon: !!a.plannedDate && a.plannedDate >= todayStr && a.plannedDate <= soonStr && a.status !== "completed",
  }));
  const overdueCount = withFlags.filter((a) => a.overdue).length;
  const dueSoonCount = withFlags.filter((a) => a.dueSoon).length;
  const heldCount = withFlags.filter((a) => a.awaitingHold && a.status !== "completed").length;
  const assignedMine = filterAssignedToMe(withFlags, session.userId).filter((a) => a.status !== "completed");
  const assignedQueue = await assignedQueuePromise;
  const visible = (assignedFilter === "me" ? assignedMine : withFlags)
    .filter((a) => !dueFilter || (dueFilter === "overdue" ? a.overdue : dueFilter === "soon" ? a.dueSoon : a.awaitingHold && a.status !== "completed"))
    .filter((a) => !statusFilter || a.status === statusFilter)
    .filter((a) => !projectFilter || a.projectId === projectFilter)
    .filter((a) => !q || `${a.activity} ${a.itpNumber} ${a.checklistNumber} ${a.projectName}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || rank[a.status] - rank[b.status] || (a.plannedDate ?? "9999").localeCompare(b.plannedDate ?? "9999"))
    .slice(0, 100);

  const activeFilterCount = [projectFilter, statusFilter, dueFilter, archiveFilter === "archived" ? "archived" : "", assignedFilter].filter(Boolean).length;
  const selectCls = FILTER_CONTROL_CLASS;
  const chipCls = "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-control-border px-4 font-medium";
  const baseParams: Record<string, string> = { q: sp.q ?? "", project: projectFilter, status: statusFilter, due: dueFilter, archived: archiveFilter === "archived" ? "archived" : "", assigned: assignedFilter };
  // Every chip keeps the other active filters (a chip never silently drops the search or project).
  const hrefFor = (o: Record<string, string>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...baseParams, ...o })) if (v) params.set(k, v);
    const q = params.toString();
    return `/inspect/start-work${q ? `?${q}` : ""}`;
  };

  return (
    <div className="max-w-5xl 2xl:max-w-7xl">
      <PageHeader
        title={<T>Start work</T>}
        subtitle={<T>Pick up work that is ready, or start something new.</T>}
        guide={
          <PageGuide
            title={tl("Start work — how this works")}
            points={[
              "Only JAGS staff see this page — anyone else is redirected straight back to the dashboard.",
              "Both cards just link to a real creation form — nothing is created by clicking here, only once you submit that form.",
              "\"ITP-driven project\" is for the full workflow: approved Inspection & Test Plans, linked checklists, intervention points and multi-party sign-off.",
              "\"Standalone assignment\" skips the ITP entirely — a focused, independent inspection (FAT, vendor visit, one-off verification) with its own checklist and report.",
            ]}
          />
        }
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={tl("Start something new")}>
        <Link href="/inspect/itps/new" className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-burgundy bg-burgundy/5 px-4 py-2.5 hover:bg-burgundy/10">
          <span>
            <span className="block text-sm font-semibold text-ink"><T>+ New ITP project</T></span>
            <span className="block text-xs text-muted"><T>Full workflow: ITP, checklists, sign-off</T></span>
          </span>
          <span aria-hidden="true" className="text-burgundy">→</span>
        </Link>
        <Link href="/inspect/standalone/new" className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-gold bg-gold/10 px-4 py-2.5 hover:bg-gold/20">
          <span>
            <span className="block text-sm font-semibold text-ink"><T>+ Standalone assignment</T></span>
            <span className="block text-xs text-muted"><T>One-off FAT, vendor visit or verification</T></span>
          </span>
          <span aria-hidden="true" className="text-burgundy">→</span>
        </Link>
      </div>

      <AssignedToMe items={assignedQueue} />

      <section className="mt-8 space-y-3" aria-labelledby="activities-heading">
        <div>
          <h2 id="activities-heading" className="text-lg font-semibold text-ink"><T>Activities ready for site work</T></h2>
          <p className="mt-1 text-sm text-muted">
            <T>Activities on approved ITPs. Open Holds show when you open one.</T>
          </p>
        </div>

        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label={tl("Quick filters")}>
          {([
            ["", "All", { status: "" }],
            ["in_progress", "In progress", { status: "in_progress" }],
            ["not_started", "Not started", { status: "not_started" }],
            ["completed", "Completed", { status: "completed" }],
          ] as const).map(([k, label, o]) => (
            <Link key={`s-${k}`} href={hrefFor(o)} aria-current={statusFilter === k ? "true" : undefined}
              className={cn(chipCls, statusFilter === k ? "border-burgundy bg-burgundy text-white" : "bg-surface text-ink")}>
              {statusFilter === k && <span aria-hidden="true">✓</span>}
              {label}
            </Link>
          ))}
          <span aria-hidden="true" className="mx-1 hidden w-px self-stretch bg-border sm:block" />
          <Link href={hrefFor({ assigned: assignedFilter === "me" ? "" : "me" })} aria-current={assignedFilter === "me" ? "true" : undefined}
            className={cn(chipCls, assignedFilter === "me" ? "border-burgundy bg-burgundy text-white" : "bg-surface text-ink")}>
            {assignedFilter === "me" && <span aria-hidden="true">✓</span>}
            <T>Assigned to me</T> ({assignedMine.length})
          </Link>
          {([["overdue", "Overdue", overdueCount, "bg-danger/10 text-danger", "!"], ["soon", "Due soon", dueSoonCount, "bg-gold/30 text-[color:var(--color-burgundy-dark)]", "★"], ["held", "Awaiting hold release", heldCount, "bg-surface-sunken text-ink", "•"]] as const).map(([k, label, n, cls, glyph]) => (
            <Link key={k} href={hrefFor({ due: dueFilter === k ? "" : k })} aria-current={dueFilter === k ? "true" : undefined}
              className={cn(chipCls, cls, dueFilter === k && "ring-2 ring-burgundy")}>
              <span aria-hidden="true">{dueFilter === k ? "✓" : glyph}</span>
              {label}: {n}
            </Link>
          ))}
        </div>

        <form method="get" action="/inspect/start-work">
          {/* Chips own status / assignment / schedule; keep them when the form is applied. */}
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          {assignedFilter && <input type="hidden" name="assigned" value={assignedFilter} />}
          {dueFilter && <input type="hidden" name="due" value={dueFilter} />}
          <FilterBar
            activeCount={activeFilterCount}
            clearHref={activeFilterCount > 0 || sp.q ? "/inspect/start-work" : undefined}
            search={<ScanSearchInput defaultValue={sp.q ?? ""} />}
            filters={
              <div className="flex w-full flex-col gap-4 md:w-auto md:flex-row md:flex-wrap md:items-end md:gap-3">
                <FilterField label={<T>Project</T>}>
                  <select name="project" defaultValue={projectFilter} className={selectCls}>
                    <option value=""><T>All projects</T></option>
                    {projectOptions.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </FilterField>
                <FilterField label={<T>Archived</T>}>
                  <select name="archived" defaultValue={archiveFilter === "archived" ? "archived" : ""} className={selectCls}>
                    <option value=""><T>Active checklists</T></option>
                    <option value="archived"><T>Archived (</T>{archivedIds.size})</option>
                  </select>
                </FilterField>
                <Button type="submit" className="w-full md:w-auto"><T>Apply</T></Button>
              </div>
            }
          />
        </form>

        {visible.length === 0 ? (
          <EmptyState
            title={activities.length === 0 ? <T>No activities are ready yet</T> : <T>No activities match these filters</T>}
            description={
              activities.length === 0
                ? <T>An ITP must be approved and have a checklist before site work can start.</T>
                : <T>Try clearing a filter or searching for something else.</T>
            }
            className="rounded-lg border border-border bg-surface"
          />
        ) : (
          <>
            <SaveOfflineButton urls={visible.filter((a) => a.status !== "completed").map((a) => `/inspect/checklists/${a.templateId}`)} />
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map((a) => (
                <li key={a.templateId}>
                  <Card className="flex h-full flex-col gap-3 !p-4">
                    <div className="min-w-0">
                      <p className="text-base font-medium leading-snug text-ink" title={`${a.itemNumber}. ${a.activity}`}>
                        <span className="line-clamp-2">{a.itemNumber}. {a.activity}</span>
                      </p>
                      <p className="mt-1 truncate text-xs text-muted" title={`${a.projectName} · ${a.itpNumber} · ${a.checklistNumber}`}>
                        {a.projectName} · {a.itpNumber} · {a.checklistNumber}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={a.status === "completed" ? "success" : a.status === "in_progress" ? "gold" : "neutral"}>{STATUS_LABEL[a.status]}</Badge>
                      {a.overdue && <Badge tone="danger"><T>Overdue</T></Badge>}
                      {a.dueSoon && <Badge tone="gold"><T>Due soon</T></Badge>}
                      {a.awaitingHold && a.status !== "completed" && <Badge tone="warning"><T>Awaiting hold release</T></Badge>}
                      {a.assignedToUserId === session.userId && <Badge tone="info"><T>Assigned to you</T></Badge>}
                      {a.assignedToUserId && a.assignedToUserId !== session.userId && <Badge tone="neutral"><T>Assigned to a team member</T></Badge>}
                      {a.plannedDate && <span className="text-xs text-muted"><T>Due</T> {a.plannedDate}</span>}
                    </div>
                    <Link
                      href={`/inspect/checklists/${a.templateId}`}
                      className={buttonVariants({ variant: a.status === "completed" ? "outline" : "primary", size: "lg", className: "mt-auto w-full" })}
                    >
                      {a.status === "completed" ? <T>View</T> : a.status === "in_progress" ? <T>Continue</T> : <T>Start</T>}
                      <span className="sr-only"> {a.itemNumber}. {a.activity}</span>
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
