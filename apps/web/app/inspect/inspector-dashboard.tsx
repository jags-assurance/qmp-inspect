import type { ReactNode } from "react";
import Link from "next/link";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { PendingActionsTable, type PendingActionItem } from "@/components/domain/pending-actions-table";
import type { AssignmentType, AssignmentStatus } from "@/lib/standalone/actions";
import { PageGuide } from "@/components/domain/page-guide";
import { QuickRaiseObservation } from "@/components/domain/quick-raise-observation";
import { TodayQueue } from "@/components/domain/today-queue";
import { buildInspectorToday } from "@/lib/dashboard/today";
import { AssignedToMe } from "@/components/domain/assigned-to-me";
import type { AssignedActivity } from "@/lib/checklists/assigned-queries";

export interface OverdueHoldRow {
  id: string;
  itpId: string | null;
  activity: string;
  itpNumber: string;
  projectLabel: string;
  daysOpen: number;
  /** "Notice period passed" or "Planned date passed". */
  reason: string;
  plannedDate: string | null;
}

export interface PendingStandaloneAssignmentItem {
  id: string;
  assignmentNumber: string;
  assignmentType: AssignmentType;
  equipmentDescription: string;
  status: AssignmentStatus;
  updatedAt: string;
  projectName: string;
}

// Same badge labels/tones as the assignment detail page (app/inspect/standalone/[id]/page.tsx's
// TYPE_LABEL/TYPE_TONE) — kept in sync deliberately rather than importing, since that page's
// constants aren't exported.
const ASSIGNMENT_TYPE_LABEL: Record<AssignmentType, string> = {
  fat: "FAT",
  witness_inspection: "Witness Inspection",
  specific_test: "Specific Test",
  pre_shipment: "Pre-Shipment",
};

const ASSIGNMENT_TYPE_TONE: Record<AssignmentType, "gold" | "info" | "neutral" | "warning"> = {
  fat: "gold",
  witness_inspection: "info",
  specific_test: "neutral",
  pre_shipment: "warning",
};

// Plain-language "what to do here" guide — folded into the page's own Guide popover rather than an
// always-open box on the dashboard body (see admin-dashboard.tsx's matching comment for why).
const INSPECTOR_GUIDE: string[] = [
  "Run field inspections: open \"New inspection\" or pick a checklist from \"My pending actions\" below to fill in results for an activity.",
  "Chase the ones not yet started or still in progress — that's exactly what \"My pending actions\" lists, split into Today and Overdue.",
  "Where an activity has a Hold point, sign-off can't happen until you've completed the checklist and it's been notified to the relevant party — \"Overdue hold points\" above flags any stuck past their notice period.",
  "If an inspection fails, raise an NCR against it so it's tracked through to closure.",
];

/**
 * The Inspector's own operational dashboard — visually aligned to the client's UI reference
 * (group-1-2-inspector-dashboard.png: greeting + date, a primary "New inspection" action, icon-
 * badge stat cards including a real "Overdue hold points" figure, and a tabbed pending-actions
 * table). Two things the mockup shows that this deliberately leaves out rather than fake: a date-
 * range filter / export button (no real reporting period or export pipeline exists yet to back
 * them) and a "Today's schedule" strip (there's no scheduling/calendar model in the schema at all)
 * — adding either would just be dead UI wired to nothing, which is the opposite of the goal here.
 */
export function InspectorDashboard({
  firstName,
  today,
  activeProjects,
  activeItps,
  pendingInspections,
  overdueHoldPoints,
  oldestHoldPointDays,
  overdueHoldItems = [],
  pendingActions,
  pendingToday,
  pendingOverdue,
  pendingStandaloneAssignments,
  ncrsAssignedToMe = [],
  assignedToMe = [],
  clearancesWidget = null,
}: {
  /** Activities assigned to this inspector personally (itp_items.assigned_to_user_id). */
  assignedToMe?: AssignedActivity[];
  /** Streamed server widget: calibrations / certificates that are lapsed or lapsing. */
  clearancesWidget?: ReactNode;
  /** The worst overdue holds (capped), each deep-linking to its ITP. */
  overdueHoldItems?: OverdueHoldRow[];
  firstName: string;
  today: string;
  activeProjects: number;
  activeItps: number;
  pendingInspections: number;
  overdueHoldPoints: number;
  oldestHoldPointDays: number;
  pendingActions: PendingActionItem[];
  pendingToday: PendingActionItem[];
  pendingOverdue: PendingActionItem[];
  pendingStandaloneAssignments: PendingStandaloneAssignmentItem[];
  ncrsAssignedToMe?: { id: string; ncrNumber: string; severity: string; description: string; dueDate: string | null; projectName: string }[];
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {greeting}, {firstName}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">Inspector Dashboard</h1>
            <PageGuide
              title="Inspector Dashboard — how this works"
              points={[
                "\"Pending actions\" is a real worklist of checklists not yet started or still a draft — sorted by real urgency (a Hold-gated activity outranks a Witness one, which outranks a plain Review/Surveillance one), not just recency.",
                "A checklist with no response two days after it was generated counts as overdue — there's no separate due-date field, so age since generation is the closest real signal.",
                "\"Overdue hold points\" are blocking-level activities that were notified but never signed off, past their project's configured notice period (or the organisation's default, or 48h if neither is set).",
                "Standalone/FAT assignments show up here too, alongside ITP-driven checklists, since both are real field work waiting on you.",
                ...INSPECTOR_GUIDE,
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">{today}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuickRaiseObservation />
          <Link
            href="/inspect/start-work"
            className="inline-flex min-h-11 items-center rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark"
          >
            New inspection
          </Link>
        </div>
      </div>

      <TodayQueue
        description="Everything on your plate across checklists, hold points and assignments, most urgent first."
        items={buildInspectorToday({
          pendingActions,
          pendingToday,
          pendingOverdue,
          overdueHoldPoints,
          oldestHoldPointDays,
          standaloneAssignments: pendingStandaloneAssignments,
        })}
        emptyText="Nothing waiting. Start a new inspection from Start work, or review Inspections."
      />
      <AssignedToMe items={assignedToMe} />
      {clearancesWidget}

      {overdueHoldItems.length > 0 && (
        <div id="overdue-holds" className="mt-6 scroll-mt-20 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-ink">Overdue hold points</h2>
            <span className="text-xs text-muted">
              Showing {overdueHoldItems.length} of {overdueHoldPoints}, oldest first
            </span>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {overdueHoldItems.map((h) => (
              <li key={h.id}>
                <Link
                  href={h.itpId ? `/inspect/itps/${h.itpId}` : "/inspect/itps"}
                  className="flex min-h-11 flex-col gap-0.5 py-2 hover:bg-off-white sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0 truncate text-sm text-ink">
                    {h.itpNumber} - {h.activity}
                  </span>
                  <span className="text-xs text-muted">
                    {h.projectLabel} - {h.reason}
                    {h.plannedDate ? ` (${h.plannedDate})` : ""} - {h.daysOpen}d
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ncrsAssignedToMe.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-ink">NCRs assigned to me</h2>
            <Link href="/inspect/ncrs" className="text-sm text-burgundy hover:underline">
              All NCRs
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {ncrsAssignedToMe.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/inspect/ncrs/${n.id}`}
                  className="flex min-h-11 flex-col gap-0.5 py-2 hover:bg-off-white sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0 truncate text-sm text-ink">
                    {n.ncrNumber} - {n.description}
                  </span>
                  <span className="text-xs text-muted">
                    {n.projectName}
                    {n.dueDate ? ` - due ${n.dueDate}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Active projects"
          href="/inspect/projects"
          value={activeProjects}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-burgundy/10 text-burgundy">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <rect x="3" y="7" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 7V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 13 5.5V7" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
          }
        />
        <StatCard
          label="Active ITPs"
          href="/inspect/itps"
          value={activeItps}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/20 text-[color:var(--color-burgundy-dark)]">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <rect x="5" y="3" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7.5 7h5M7.5 10h5M7.5 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
          }
        />
        <StatCard
          label="Inspections in progress"
          value={pendingInspections}
          href="/inspect/inspections?result=in_progress"
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-info/10 text-info">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <rect x="4" y="4" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6.5 10l2 2 4-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          }
        />
        <StatCard
          label="Overdue hold points"
          value={overdueHoldPoints}
          href={overdueHoldPoints > 0 ? "#overdue-holds" : undefined}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-danger/10 text-danger">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path d="M10 3.5l7 12.5H3l7-12.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M10 8.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="10" cy="13.5" r="0.75" fill="currentColor" />
              </svg>
            </span>
          }
        />
      </div>
      {overdueHoldPoints > 0 && (
        <p className="mt-2 text-xs text-muted">
          Oldest: {oldestHoldPointDays} day{oldestHoldPointDays === 1 ? "" : "s"}
        </p>
      )}

      <div id="pending-actions" className="mt-8 scroll-mt-20 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">My pending actions</h2>
        <p className="mt-1 text-sm text-muted">
          Checklists not yet started, or still in progress, across every project you have access to.
        </p>
        <div className="mt-4">
          <PendingActionsTable all={pendingActions} today={pendingToday} overdue={pendingOverdue} />
        </div>

        {pendingStandaloneAssignments.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-ink">Standalone assignments in progress</h3>
            <p className="mt-1 text-xs text-muted">
              FATs, witness inspections, specific tests and pre-shipment checks not yet finalized.
            </p>
            <ul className="mt-3 space-y-2">
              {pendingStandaloneAssignments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={ASSIGNMENT_TYPE_TONE[a.assignmentType]}>
                      {ASSIGNMENT_TYPE_LABEL[a.assignmentType]}
                    </Badge>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink">{a.equipmentDescription}</div>
                      <div className="doc-id text-xs text-muted">
                        {a.assignmentNumber}
                        {a.projectName && <span> · {a.projectName}</span>}
                      </div>
                    </div>
                  </div>
                  <Link href={`/inspect/standalone/${a.id}`} className="shrink-0 text-sm text-burgundy hover:underline">
                    {a.status === "draft" ? "Continue →" : "View →"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
