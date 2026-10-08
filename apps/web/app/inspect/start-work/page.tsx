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

type StatusKey = "not_started" | "in_progress" | "completed";
const STATUS_LABEL: Record<StatusKey, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};
const STATUS_CLASS: Record<StatusKey, string> = {
  not_started: "bg-off-white text-muted",
  in_progress: "bg-gold/30 text-[color:var(--color-burgundy-dark)]",
  completed: "bg-success/10 text-success",
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
    itp_sections: { itps: { id: string; itp_number: string; status: string; projects: { id: string; name: string; organization_id: string; enforce_hold_blocks_start: boolean } | null } | null } | null;
  } | null;
}

export default async function StartWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; project?: string; due?: string; archived?: string }>;
}) {
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const statusFilter = (["not_started", "in_progress", "completed"] as const).find((k) => k === sp.status) ?? "";
  const projectFilter = sp.project ?? "";
  const dueFilter = (["overdue", "soon", "held"] as const).find((k) => k === sp.due) ?? "";

  const archiveFilter = parseArchiveFilter(sp.archived);

  const supabase = await createSupabaseServerClient();
  const archivedIds = await loadArchivedTemplateIds(supabase);
  const [{ data: allTemplates }, { data: records }] = await Promise.all([
    supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select(
        "id, checklist_number, itp_item_id, itp_items(id, item_number, activity, planned_date, itp_sections(itps(id, itp_number, status, projects(id, name, organization_id, enforce_hold_blocks_start))))"
      )
      .limit(1000)
      .returns<TemplateRow[]>(),
    supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("itp_item_id, checklist_template_id, overall_result")
      .limit(5000)
      .returns<{ itp_item_id: string; checklist_template_id: string; overall_result: string | null }[]>(),
  ]);

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
  const [{ data: openProgress }, { data: blockingLevels }] = await Promise.all([
    itemIds.length
      ? supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("itp_item_id, intervention")
          .in("itp_item_id", itemIds)
          .in("status", ["pending", "notified"])
          .limit(10000)
          .returns<{ itp_item_id: string; intervention: string }[]>()
      : Promise.resolve({ data: [] as { itp_item_id: string; intervention: string }[] }),
    supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("organization_id, code")
      .eq("is_blocking", true)
      .returns<{ organization_id: string; code: string }[]>(),
  ]);
  const blockingKeys = new Set((blockingLevels ?? []).map((l) => `${l.organization_id}:${l.code}`));
  const openByItem = new Map<string, string[]>();
  for (const pr of openProgress ?? []) openByItem.set(pr.itp_item_id, [...(openByItem.get(pr.itp_item_id) ?? []), pr.intervention]);

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
  const visible = withFlags
    .filter((a) => !dueFilter || (dueFilter === "overdue" ? a.overdue : dueFilter === "soon" ? a.dueSoon : a.awaitingHold && a.status !== "completed"))
    .filter((a) => !statusFilter || a.status === statusFilter)
    .filter((a) => !projectFilter || a.projectId === projectFilter)
    .filter((a) => !q || `${a.activity} ${a.itpNumber} ${a.checklistNumber} ${a.projectName}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || rank[a.status] - rank[b.status] || (a.plannedDate ?? "9999").localeCompare(b.plannedDate ?? "9999"))
    .slice(0, 100);

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">Start work</h1>
        <PageGuide
          title="Start work — how this works"
          points={[
            "Only JAGS staff see this page — anyone else is redirected straight back to the dashboard.",
            "Both cards just link to a real creation form — nothing is created by clicking here, only once you submit that form.",
            "\"ITP-driven project\" is for the full workflow: approved Inspection & Test Plans, linked checklists, intervention points and multi-party sign-off.",
            "\"Standalone assignment\" skips the ITP entirely — a focused, independent inspection (FAT, vendor visit, one-off verification) with its own checklist and report.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Choose the workflow that best matches the engagement. Both options take you to the real
        creation form — nothing is created until you submit it there.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <WorkModeCard
          badge="Full workflow"
          title="ITP-driven project"
          description="Plan and control a project through approved Inspection & Test Plans, linked checklists, intervention points and multi-party sign-off."
          bullets={[
            "Structured ITP workflow",
            "Client approval and intervention points",
            "Linked inspections, NCRs and data book",
          ]}
          bestFor="Best for projects and work packages"
          href="/inspect/itps/new"
          cta="Start ITP-driven project"
          emphasized
        />
        <WorkModeCard
          badge="Quick setup"
          title="Standalone assignment"
          description="Create a focused inspection without building a full project ITP. Ideal for FATs, vendor visits and one-off verification."
          bullets={[
            "Fast assignment setup",
            "Custom checklist and evidence",
            "Independent report and sign-off",
          ]}
          bestFor="Best for one-off or vendor inspections"
          href="/inspect/standalone/new"
          cta="Start standalone assignment"
        />
      </div>

      <section className="mt-10" aria-labelledby="activities-heading">
        <h2 id="activities-heading" className="text-lg font-semibold text-ink">Activities ready for site work</h2>
        <p className="mt-1 text-sm text-muted">
          Activities on approved ITPs. An open Hold on an activity is shown when you open it — the inspection can start once it is released.
        </p>
        <form method="get" className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
<ScanSearchInput defaultValue={sp.q ?? ""} />
          <select name="project" defaultValue={projectFilter} aria-label="Project" className="min-h-11 rounded-md border border-border bg-off-white px-3 py-2 text-sm">
            <option value="">All projects</option>
            {projectOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select name="status" defaultValue={statusFilter} aria-label="Status" className="min-h-11 rounded-md border border-border bg-off-white px-3 py-2 text-sm">
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABEL) as StatusKey[]).map((k) => (
              <option key={k} value={k}>{STATUS_LABEL[k]}</option>
            ))}
          </select>
          <select name="due" defaultValue={dueFilter} aria-label="Schedule" className="min-h-11 rounded-md border border-border bg-off-white px-3 py-2 text-sm">
            <option value="">Any schedule</option>
            <option value="overdue">Overdue ({overdueCount})</option>
            <option value="soon">Due soon - 7 days ({dueSoonCount})</option>
            <option value="held">Awaiting hold release ({heldCount})</option>
          </select>
          <select name="archived" defaultValue={archiveFilter === "archived" ? "archived" : ""} aria-label="Archived" className="min-h-11 rounded-md border border-border bg-off-white px-3 py-2 text-sm">
            <option value="">Active checklists</option>
            <option value="archived">Archived ({archivedIds.size})</option>
          </select>
          <button type="submit" className="min-h-11 rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark">Filter</button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {([["overdue", "Overdue", overdueCount, "bg-danger/10 text-danger"], ["soon", "Due soon", dueSoonCount, "bg-gold/30 text-[color:var(--color-burgundy-dark)]"], ["held", "Awaiting hold release", heldCount, "bg-off-white text-ink"]] as const).map(([k, label, n, cls]) => (
            <Link
              key={k}
              href={`/inspect/start-work?due=${dueFilter === k ? "" : k}`}
              className={cn("rounded-full px-3 py-1 font-medium", cls, dueFilter === k && "ring-2 ring-burgundy")}
            >
              {label}: {n}
            </Link>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="mt-4 rounded-md bg-off-white p-4 text-sm text-muted">
            {activities.length === 0
              ? "No activities are ready yet — an ITP must be approved and have a checklist before site work can start."
              : "No activities match these filters."}
          </p>
        ) : (
          <>
          <SaveOfflineButton urls={visible.filter((a) => a.status !== "completed").map((a) => `/inspect/checklists/${a.templateId}`)} />
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {visible.map((a) => (
              <li key={a.templateId}>
                <Link href={`/inspect/checklists/${a.templateId}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-off-white">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{a.itemNumber}. {a.activity}</span>
                    <span className="block truncate text-xs text-muted">{a.projectName} · {a.itpNumber} · {a.checklistNumber}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                    {a.plannedDate && <span className="text-xs text-muted">{a.plannedDate}</span>}
                    {a.overdue && <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">Overdue</span>}
                    {a.dueSoon && <span className="rounded-full bg-gold/30 px-2.5 py-0.5 text-xs font-medium text-[color:var(--color-burgundy-dark)]">Due soon</span>}
                    {a.awaitingHold && a.status !== "completed" && <span className="rounded-full bg-off-white px-2.5 py-0.5 text-xs font-medium text-ink">Awaiting hold release</span>}
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_CLASS[a.status])}>
                      {STATUS_LABEL[a.status]}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          </>
        )}
      </section>
    </div>
  );
}

function WorkModeCard({
  badge,
  title,
  description,
  bullets,
  bestFor,
  href,
  cta,
  emphasized = false,
}: {
  badge: string;
  title: string;
  description: string;
  bullets: string[];
  bestFor: string;
  href: string;
  cta: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-surface",
        emphasized ? "border-burgundy" : "border-border"
      )}
    >
      <div
        className={cn(
          "rounded-t-lg px-5 pb-4 pt-5",
          emphasized ? "bg-burgundy/5" : "bg-gold/10"
        )}
      >
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            emphasized ? "bg-burgundy text-white" : "bg-gold/30 text-[color:var(--color-burgundy-dark)]"
          )}
        >
          {badge}
        </span>
        <h2 className="mt-3 text-xl font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </div>

      <ul className="flex-1 space-y-2 px-5 py-4 text-sm text-ink">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span className={cn("mt-0.5", emphasized ? "text-burgundy" : "text-gold")}>✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <p className="border-t border-border px-5 py-3 text-xs text-muted">
        <span className={emphasized ? "text-burgundy" : "text-[color:var(--color-burgundy-dark)]"}>★</span>{" "}
        {bestFor}
      </p>

      <div className="px-5 pb-5">
        <Link
          href={href}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            emphasized
              ? "bg-burgundy text-white hover:bg-burgundy-dark"
              : "border border-burgundy text-burgundy hover:bg-burgundy/5"
          )}
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
