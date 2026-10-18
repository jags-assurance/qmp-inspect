import { Tx } from "@/components/domain/tx";
import type { ReactNode } from "react";
import Link from "next/link";
import { StatTile, StatGrid } from "@/components/ui/stat-tile";
import { Disclosure } from "@/components/ui/disclosure";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { PendingActionsTable, type PendingActionItem } from "@/components/domain/pending-actions-table";
import type { AssignmentType, AssignmentStatus } from "@/lib/standalone/actions";
import { PageGuide } from "@/components/domain/page-guide";
import { QuickRaiseObservation } from "@/components/domain/quick-raise-observation";
import { TodayQueue } from "@/components/domain/today-queue";
import { buildInspectorToday } from "@/lib/dashboard/today";
import { AssignedToMe } from "@/components/domain/assigned-to-me";
import type { AssignedActivity } from "@/lib/checklists/assigned-queries";
import { T } from "@/components/domain/t";
import { buttonVariants } from "@/components/ui/button";

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
  "Run field inspections: open \"Start work\" or pick a checklist from \"My pending actions\" below to fill in results for an activity.",
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
  nextSteps = null,
}: {
  /** "Your next steps" card (process flow + green button). */
  nextSteps?: ReactNode;
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

  const continueItem = pendingActions.find((a) => a.status === "in_progress") ?? pendingActions[0] ?? null;

  return (
    <div>
      <PageHeader
        title={<Tx>Inspector Dashboard</Tx>}
        subtitle={
          <>
            <span suppressHydrationWarning>{greeting}, {firstName}</span> · {today}
          </>
        }
        guide={
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
        }
        primaryAction={
          // Both field actions stay visible on a phone. Quick observation owns a side panel and a toast, so it must
          // never sit inside the header's "..." menu (that menu unmounts its content as soon as it closes).
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {continueItem ? (
              <Link href={`/inspect/checklists/${continueItem.templateId}`} className={buttonVariants()}>
                {continueItem.status === "in_progress" ? <T>Continue inspection</T> : <T>Start next inspection</T>}
              </Link>
            ) : (
              <Link href="/inspect/start-work" className={buttonVariants()}>
                <T>Start work</T>
              </Link>
            )}
            <QuickRaiseObservation />
          </div>
        }
      />
      {nextSteps}

      {/* Order: what needs my attention first, KPIs next, then the full lists. */}
      <div className="space-y-5">
        <TodayQueue
          className="mt-0"
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
        <AssignedToMe items={assignedToMe} className="mt-0" />
        {clearancesWidget}

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2 xl:has-[>:only-child]:grid-cols-1 empty:hidden">
        {overdueHoldItems.length > 0 && (
          <Section
            id="overdue-holds"
            className="scroll-mt-24"
            title={<Tx>Overdue hold points</Tx>}
            actions={
              <span className="text-xs text-muted">
                <T>Showing</T> {overdueHoldItems.length} <T>of</T> {overdueHoldPoints}<T>, oldest first</T>
              </span>
            }
          >
            <ul className="-my-2 divide-y divide-border">
              {overdueHoldItems.map((h) => (
                <li key={h.id}>
                  <Link
                    href={h.itpId ? `/inspect/itps/${h.itpId}` : "/inspect/itps"}
                    className="flex min-h-11 flex-col gap-0.5 rounded-md py-2 hover:bg-surface-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-ink" title={`${h.itpNumber} - ${h.activity}`}>
                      {h.itpNumber} - {h.activity}
                    </span>
                    <span className="text-xs text-muted [overflow-wrap:anywhere]">
                      {h.projectLabel} - {h.reason}
                      {h.plannedDate ? ` (${h.plannedDate})` : ""} - {h.daysOpen}<T>d</T>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {ncrsAssignedToMe.length > 0 && (
          <Section
            title={<Tx>NCRs assigned to me</Tx>}
            actions={
              <Link href="/inspect/ncrs" className="inline-flex min-h-9 items-center text-sm font-medium text-brand hover:underline">
                <T>All NCRs</T>
              </Link>
            }
          >
            <ul className="-my-2 divide-y divide-border">
              {ncrsAssignedToMe.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/inspect/ncrs/${n.id}`}
                    className="flex min-h-11 flex-col gap-0.5 rounded-md py-2 hover:bg-surface-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-ink" title={`${n.ncrNumber} - ${n.description}`}>
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
          </Section>
        )}
        </div>

        <StatGrid max={4}>
          <StatTile
            label="Overdue hold points"
            value={overdueHoldPoints}
            href={overdueHoldPoints > 0 ? "#overdue-holds" : undefined}
            tone="danger"
            caption={
              overdueHoldPoints > 0 ? (
                <>
                  <T>Oldest:</T> {oldestHoldPointDays} <T>day</T>{oldestHoldPointDays === 1 ? "" : "s"}
                </>
              ) : undefined
            }
            icon={
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path d="M10 3.5l7 12.5H3l7-12.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M10 8.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="10" cy="13.5" r="0.75" fill="currentColor" />
              </svg>
            }
          />
          <StatTile
            label="Inspections in progress"
            value={pendingInspections}
            href="/inspect/inspections?result=in_progress"
            tone="info"
            icon={
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <rect x="4" y="4" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6.5 10l2 2 4-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
          <StatTile
            label="Active ITPs"
            value={activeItps}
            href="/inspect/itps"
            tone="gold"
            icon={
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <rect x="5" y="3" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7.5 7h5M7.5 10h5M7.5 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            }
          />
          <StatTile
            label="Active projects"
            value={activeProjects}
            href="/inspect/projects"
            tone="brand"
            icon={
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <rect x="3" y="7" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 7V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 13 5.5V7" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            }
          />
        </StatGrid>

        {/* The same checklists are already in "Today" above, so the full table (with its All / Today / Overdue
            tabs) stays folded until someone wants the complete list. */}
        <Disclosure
          id="pending-actions"
          variant="card"
          className="scroll-mt-24"
          summary={<><T>All my checklists</T> ({pendingActions.length})</>}
        >
          <PendingActionsTable all={pendingActions} today={pendingToday} overdue={pendingOverdue} />

          {pendingStandaloneAssignments.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-ink"><T>Standalone assignments in progress</T></h3>
              <p className="mt-1 text-xs text-muted">
                <T>Tests and checks not yet finalized.</T>
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
                        <div className="truncate text-sm text-ink" title={a.equipmentDescription}>{a.equipmentDescription}</div>
                        <div className="doc-id text-xs text-muted">
                          {a.assignmentNumber}
                          {a.projectName && <span> · {a.projectName}</span>}
                        </div>
                      </div>
                    </div>
                    <Link href={`/inspect/standalone/${a.id}`} className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-brand hover:underline">
                      {a.status === "draft" ? "Continue →" : "View →"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Disclosure>
      </div>
    </div>
  );
}
