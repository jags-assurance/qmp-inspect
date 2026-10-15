"use client";

import { Tx } from "@/components/domain/tx";
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { SignoffCell } from "@/components/domain/signoff-cell";
import type { SignoffStatus } from "@/lib/signoff/db-types";
import { PageGuide } from "@/components/domain/page-guide";
import { useUrlPanel } from "@/components/ui/side-panel";
import { TodayQueue } from "@/components/domain/today-queue";
import { buildExternalToday } from "@/lib/dashboard/today";
import { ItpReviewPanel } from "./itp-review-panel";
import { widgetOrderFor, resolveDashboardRole, type ExternalWidget, type OrgHealth } from "@/lib/dashboard/widgets";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button, buttonVariants } from "@/components/ui/button";

export interface DashboardLevelOption {
  code: string;
  label: string;
  is_blocking: boolean;
}

// Tone assigned by is_blocking rather than a fixed code — a blocking level (Hold-equivalent, per
// this organisation's own intervention_level_types) always reads as "danger", matching the original
// H=danger tone; every non-blocking level reads as "warning", matching the original W/R/S tones
// closely enough (this dashboard's badge only has room for one non-neutral accent per row anyway).
function toneForLevel(level: DashboardLevelOption | undefined): "danger" | "warning" | "neutral" {
  if (!level) return "neutral";
  return level.is_blocking ? "danger" : "warning";
}

const ROLE_LABEL: Record<string, string> = {
  client: "Client",
  subcontractor: "Subcontractor",
  main_contractor: "Main Contractor",
  tpi_lab: "TPI / Lab",
};

// Plain-language responsibility guide per role, shown at the top of this dashboard. Each role sees
// the same page shape (stat cards, queue panels) but what's actually theirs to do differs sharply —
// this exists because that difference wasn't obvious from the panels alone (real feedback: a TPI/lab
// user couldn't tell field-checklist entry wasn't their job, and a subcontractor couldn't tell
// sign-off vs self-inspection apart). Kept to short, concrete "you do X, here's where" bullets rather
// than a general role description.
const ROLE_GUIDE: Record<string, string[]> = {
  client: [
    "JAGS Assurance runs inspections on your behalf — you don't fill in field checklists yourself.",
    "Once JAGS approves an ITP, accepting it is your last step before field work can start — see \"ITPs awaiting your acceptance\" below.",
    "Where you hold a Review (R) point on an activity, you review the contractor's evidence and sign off — see \"Awaiting your sign-off\" below.",
    "Any NCR raised on your project stays visible under \"NCRs assigned to you\" until it's closed.",
  ],
  subcontractor: [
    "You perform the physical work, so you fill in the field checklist yourself for activities you're assigned to — open the checklist from the ITP and record results as you go.",
    "Where you hold a Hold (H) or Witness (W) point, you'll be notified and must sign off before the activity can proceed — see \"Awaiting your sign-off\" below.",
    "Any NCR raised against your work needs root cause and corrective action from you — see \"NCRs assigned to you\" below.",
  ],
  main_contractor: [
    "You may self-inspect and fill in field checklists for activities directly under your own scope.",
    "Where a subcontractor has already signed off their part, it's your job to review their work and add your own sign-off — see \"Work awaiting your review\" below.",
    "Where you hold your own Hold/Witness/Review point, sign off directly from \"Awaiting your sign-off\" below.",
  ],
  tpi_lab: [
    "You're an independent inspector — you never fill in the field checklist; the contractor performing the work does that.",
    "Your job is to independently verify: once notified of a Hold/Witness point, inspect in person, then Sign off — or, for a Hold, withhold sign-off until you're satisfied — see \"Awaiting your sign-off\" below.",
  ],
};

export interface SignoffQueueRow {
  id: string;
  intervention: string;
  status: SignoffStatus;
  activity: string;
  itpId: string;
  itpNumber: string;
  itpTitle: string;
  when: string | null;
}

export interface ItpAwaitingAcceptanceRow {
  id: string;
  itpNumber: string;
  title: string;
  projectName: string;
}

export interface MyProjectRow {
  id: string;
  name: string;
}

export interface AssignedPunchRow {
  id: string;
  projectId: string;
  description: string;
  dueDate: string | null;
  projectName: string;
}

export interface AssignedNcrRow {
  id: string;
  ncrNumber: string;
  severity: "observation" | "minor_ncr" | "major_ncr";
  description: string;
  dueDate: string | null;
  projectName: string;
}

const NCR_SEVERITY_TONE: Record<AssignedNcrRow["severity"], "danger" | "warning" | "info"> = {
  major_ncr: "danger",
  minor_ncr: "warning",
  observation: "info",
};

const NCR_SEVERITY_LABEL: Record<AssignedNcrRow["severity"], string> = {
  major_ncr: "Major NCR",
  minor_ncr: "Minor NCR",
  observation: "Observation",
};

/**
 * The dashboard landing for the four non-staff roles (client, subcontractor, main contractor,
 * TPI/lab) — visually aligned to the client's own UI reference (group-6-4-client-kpi-dashboard.png:
 * icon-badge stat cards, a real data table with status chips for open items, avatar-style initials
 * for who's involved). Every number and row here is a real, RLS-scoped query result computed by the
 * parent page — nothing here is fabricated or placeholder data, including trend/delta figures,
 * which the reference mockup shows but this app has no historical snapshot to compute honestly, so
 * they're deliberately left out rather than invented.
 *
 * Deliberately scoped to only the external-party view (Reqs: "role-wise dashboards, one at a time")
 * — the JAGS Admin and Inspector dashboards in page.tsx are untouched by this component.
 */
export function ExternalPartyDashboard({
  orgName,
  roleKey,
  today,
  activeProjects,
  activeItps,
  pendingInspections,
  openNcrs,
  myProjects,
  itpsAwaitingAcceptance,
  workAwaitingReview,
  pendingSignoffs,
  levels,
  ncrsAssignedToMe,
  managesOwnOrg,
  orgHealth,
  punchAssignedToMe = [],
  totals,
  clearancesWidget = null,
}: {
  /** Streamed server widget: calibrations / certificates that are lapsed or lapsing. */
  clearancesWidget?: ReactNode;
  punchAssignedToMe?: AssignedPunchRow[];
  /** True counts behind each capped list (the lists show at most 5 rows). */
  totals?: { acceptance: number; review: number; signoffs: number; ncrs: number; punch: number };
  orgName: string | null;
  /** project_parties.party_type of the user's own linked party, e.g. "client" | "subcontractor". */
  roleKey: string | null;
  today: string;
  activeProjects: number;
  activeItps: number;
  pendingInspections: number;
  openNcrs: number;
  /** This party's own linked projects — used for the "Your projects" quick-link row below, since
   *  the PDF/Excel reports, data book and activity timeline for a project were previously only
   *  reachable by first opening the Projects register and clicking into one. */
  myProjects: MyProjectRow[];
  itpsAwaitingAcceptance: ItpAwaitingAcceptanceRow[];
  workAwaitingReview: SignoffQueueRow[];
  pendingSignoffs: SignoffQueueRow[];
  /** This party's ORGANISATION's configured intervention levels — replaces the old hardcoded
   *  H/W/R/S tone/label maps so a custom level renders with its real label and a sensible tone. */
  levels: DashboardLevelOption[];
  ncrsAssignedToMe: AssignedNcrRow[];
  /** True for a client login whose organisation is self-/client-managed — they get the org-health widget. */
  managesOwnOrg: boolean;
  orgHealth: OrgHealth | null;
}) {
  const tl = useTranslate();
  const panel = useUrlPanel("panel");
  const [panelKind, panelId] = (panel.value ?? "").split(":");
  const reviewItpId = panelKind === "itp" ? (itpsAwaitingAcceptance.find((i) => i.id === panelId)?.id ?? null) : null;
  const roleLabel = roleKey ? (ROLE_LABEL[roleKey] ?? roleKey) : "Project party";
  const t = {
    acceptance: totals?.acceptance ?? itpsAwaitingAcceptance.length,
    review: totals?.review ?? workAwaitingReview.length,
    signoffs: totals?.signoffs ?? pendingSignoffs.length,
    ncrs: totals?.ncrs ?? ncrsAssignedToMe.length,
    punch: totals?.punch ?? punchAssignedToMe.length,
  };
  const needsAttention = t.acceptance + t.review + t.signoffs + t.ncrs + t.punch;
  const moreLink = (shown: number, total: number, href: string, label: string) =>
    total > shown ? (
      <p className="mt-3 text-sm">
        <Link href={href} className="font-medium text-burgundy hover:underline">
          {label} ({total - shown} <Tx>more) →</Tx>
        </Link>
      </p>
    ) : null;

  const widgets: Record<ExternalWidget, ReactNode> = {
    orgHealth: (
      <>
      {orgHealth && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink"><Tx>Your organisation at a glance</Tx></h2>
          <p className="mt-1 text-sm text-muted">
            <Tx>Your organisation at a glance.</Tx>
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link href="/inspect/manage" className="rounded-md border border-border p-3 hover:bg-off-white">
              <p className="text-xs text-muted"><Tx>Parties with a login</Tx></p>
              <p className="mt-1 text-xl font-semibold text-ink">
                {orgHealth.partiesWithLogin} <span className="text-sm font-normal text-muted"><Tx>of</Tx> {orgHealth.activeParties}</span>
              </p>
              <p className="mt-0.5 text-xs text-burgundy"><Tx>Manage access →</Tx></p>
            </Link>
            <Link href="/inspect/ncrs" className="rounded-md border border-border p-3 hover:bg-off-white">
              <p className="text-xs text-muted"><Tx>Overdue NCRs</Tx></p>
              <p className={"mt-1 text-xl font-semibold " + (orgHealth.overdueNcrs > 0 ? "text-danger" : "text-ink")}>
                {orgHealth.overdueNcrs}
              </p>
              <p className="mt-0.5 text-xs text-burgundy"><Tx>Open NCRs →</Tx></p>
            </Link>
            <Link href="/inspect/projects" className="rounded-md border border-border p-3 hover:bg-off-white">
              <p className="text-xs text-muted"><Tx>Open punch-list items</Tx></p>
              <p className="mt-1 text-xl font-semibold text-ink">{orgHealth.openPunchItems}</p>
              <p className="mt-0.5 text-xs text-burgundy"><Tx>Projects →</Tx></p>
            </Link>
          </div>
        </div>
      )}

      </>
    ),
    acceptance: (
      <>
      {itpsAwaitingAcceptance.length > 0 && (
        <div className="mt-8">
          <h2 className="font-medium text-ink"><Tx>ITPs awaiting your acceptance</Tx></h2>
          <p className="mt-1 text-sm text-muted">
            <Tx>Your acceptance is the last step before work starts.</Tx>
          </p>
          <div className="mt-3">
            <DataTable
              rows={itpsAwaitingAcceptance}
              searchPlaceholder="Search ITPs…"
              searchKeys={(r) => `${r.itpNumber} ${r.title} ${r.projectName}`}
              emptyMessage="Nothing awaiting your acceptance."
              columns={[
                { key: "number", header: "ITP", render: (r) => <span className="doc-id text-ink">{r.itpNumber}</span> },
                { key: "title", header: "Title", render: (r) => r.title },
                { key: "project", header: "Project", render: (r) => <span className="text-muted">{r.projectName}</span> },
                { key: "status", header: "Status", render: () => <Badge tone="gold"><Tx>Awaiting acceptance</Tx></Badge> },
                {
                  key: "action",
                  header: "",
                  render: (r) => (
                    <Button
                      type="button"
                      onClick={() => panel.open(`itp:${r.id}`)}
                      variant="link"
                    >
                      <Tx>Review & accept →</Tx>
                    </Button>
                  ),
                },
              ]}
            />
          </div>
          {moreLink(itpsAwaitingAcceptance.length, t.acceptance, "/inspect/itps", "See all ITPs")}
        </div>
      )}

      </>
    ),
    review: (
      <>
      {workAwaitingReview.length > 0 && (
        <SignoffQueuePanel
          title={tl("Work awaiting your review")}
          description="Your sign-off follows a subcontractor&apos;s."
          rows={workAwaitingReview}
          levels={levels}
          footer={moreLink(workAwaitingReview.length, t.review, "/inspect/itps", "See all ITPs")}
        />
      )}

      </>
    ),
    signoffs: (
      <>
      <SignoffQueuePanel
        title={tl("Awaiting your sign-off")}
        description="Points on your party's column awaiting Notify or Sign off."
        rows={pendingSignoffs}
        levels={levels}
        emptyMessage="Nothing awaiting your sign-off right now. New hold and witness points appear here when JAGS notifies you."
        footer={moreLink(pendingSignoffs.length, t.signoffs, "/inspect/itps", "See all ITPs")}
      />

      </>
    ),
    ncrs: (
      <>
      {ncrsAssignedToMe.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink"><Tx>NCRs assigned to you</Tx></h2>
          <p className="mt-1 text-sm text-muted">
            <Tx>Raised against your organisation and still open.</Tx>
          </p>
          <ul className="mt-4 space-y-2">
            {ncrsAssignedToMe.map((ncr) => (
              <li
                key={ncr.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={NCR_SEVERITY_TONE[ncr.severity]}>{NCR_SEVERITY_LABEL[ncr.severity]}</Badge>
                    <span className="doc-id text-ink">{ncr.ncrNumber}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {ncr.projectName} — {ncr.description}
                    {ncr.dueDate && <span className="ms-2"><Tx>Due</Tx> {ncr.dueDate}</span>}
                  </div>
                </div>
                <Link
                  href={`/inspect/ncrs/${ncr.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm", className: "shrink-0" })}
                >
                  <Tx>Close out →</Tx>
                </Link>
              </li>
            ))}
          </ul>
          {moreLink(ncrsAssignedToMe.length, t.ncrs, "/inspect/ncrs", "See all NCRs")}
        </div>
      )}

      {punchAssignedToMe.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink"><Tx>Punch items assigned to you</Tx></h2>
          <p className="mt-1 text-sm text-muted"><Tx>Punch-list items you need to fix.</Tx></p>
          <ul className="mt-4 space-y-2">
            {punchAssignedToMe.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate text-ink">{p.description}</div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {p.projectName}
                    {p.dueDate && <span className="ms-2"><Tx>Due</Tx> {p.dueDate}</span>}
                  </div>
                </div>
                <Link
                  href={`/inspect/projects/${p.projectId}?tab=punch-list&item=${p.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm", className: "shrink-0" })}
                >
                  <Tx>Open →</Tx>
                </Link>
              </li>
            ))}
          </ul>
          {t.punch > punchAssignedToMe.length && (
            <p className="mt-3 text-sm text-muted">{t.punch - punchAssignedToMe.length} <Tx>more on the project punch lists.</Tx></p>
          )}
        </div>
      )}

      </>
    ),
    stats: (
      <>
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Active projects"
          value={activeProjects}
          href="/inspect/projects"
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
          value={activeItps}
          href="/inspect/itps"
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
          label="Open NCRs"
          value={openNcrs}
          href="/inspect/ncrs"
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
        <StatCard
          label="Needs your attention"
          value={needsAttention}
          href={needsAttention > 0 ? "#today-queue-title" : undefined}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/10 text-warning">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 6.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="10" cy="13" r="0.75" fill="currentColor" />
              </svg>
            </span>
          }
        />
      </div>

      </>
    ),
    projects: (
      <>
      {myProjects.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink"><Tx>Your projects — reports &amp; documents</Tx></h2>
          <p className="mt-1 text-sm text-muted">
            <Tx>Data books, reports and activity per project.</Tx>
          </p>
          <ul className="mt-4 space-y-3">
            {myProjects.slice(0, 3).map((project) => (
              <li key={project.id} className="rounded-md border border-border p-3">
                <p className="truncate text-sm font-medium text-ink">{project.name}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <Link
                    href={`/inspect/projects/${project.id}?tab=punch-list`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>Punch list →</Tx>
                  </Link>
                  <Link
                    href={`/inspect/projects/${project.id}/reports`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>Reports &amp; downloads →</Tx>
                  </Link>
                  <Link
                    href={`/inspect/projects/${project.id}/data-book`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>Data book →</Tx>
                  </Link>
                  <Link
                    href={`/inspect/projects/${project.id}/activity`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>Activity →</Tx>
                  </Link>
                  <Link
                    href={`/inspect/projects/${project.id}/kpis`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>KPIs →</Tx>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {myProjects.length > 3 && (
            <details className="group mt-3">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
                <Tx>Show all</Tx> ({myProjects.length})
              </summary>
              <ul className="mt-3 space-y-3">
            {myProjects.slice(3).map((project) => (
              <li key={project.id} className="rounded-md border border-border p-3">
                <p className="truncate text-sm font-medium text-ink">{project.name}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <Link
                    href={`/inspect/projects/${project.id}?tab=punch-list`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>Punch list →</Tx>
                  </Link>
                  <Link
                    href={`/inspect/projects/${project.id}/reports`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>Reports &amp; downloads →</Tx>
                  </Link>
                  <Link
                    href={`/inspect/projects/${project.id}/data-book`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>Data book →</Tx>
                  </Link>
                  <Link
                    href={`/inspect/projects/${project.id}/activity`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>Activity →</Tx>
                  </Link>
                  <Link
                    href={`/inspect/projects/${project.id}/kpis`}
                    className="font-medium text-burgundy hover:underline"
                  >
                    <Tx>KPIs →</Tx>
                  </Link>
                </div>
              </li>
            ))}
              </ul>
            </details>
          )}
        </div>
      )}

      </>
    ),
  };
  const widgetOrder = widgetOrderFor(resolveDashboardRole(roleKey, managesOwnOrg));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink">{orgName ? `${orgName} Dashboard` : "Dashboard"}</h1>
        <PageGuide
          title={tl("Dashboard — how this works")}
          points={[
            "The stat cards and queues below are scoped to your organisation's own access — RLS decides what you see, not this page.",
            "\"Needs attention\" combines ITPs awaiting your acceptance, work awaiting your review, sign-offs pending on you, and NCRs assigned to you — click any row to act on it directly.",
            "Accepting an ITP is a whole-ITP client step, separate from signing off an individual intervention grid cell (that's the contractor/subcontractor/TPI's job on that activity).",
            "\"Your projects\" links straight into each project's Reports, Data Book, Activity and KPIs — no need to go through the Projects register first.",
            ...(roleKey && ROLE_GUIDE[roleKey] ? ROLE_GUIDE[roleKey] : []),
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        {roleLabel} · {today}
      </p>

      <TodayQueue
        emptyText="You are all caught up. Check Reports & documents below, or open Inspections to follow progress."
        description="Most urgent first."
        items={buildExternalToday({
          acceptance: itpsAwaitingAcceptance,
          review: workAwaitingReview,
          signoffs: pendingSignoffs,
          ncrs: ncrsAssignedToMe,
        })}
      />
      {clearancesWidget}

      {(widgetOrder).map((key) => (
        <Fragment key={key}>{widgets[key]}</Fragment>
      ))}

      <ItpReviewPanel itpId={reviewItpId} onClose={panel.close} />
    </div>
  );
}

function SignoffQueuePanel({
  title,
  description,
  rows,
  levels,
  emptyMessage,
  footer,
}: {
  title: string;
  description: string;
  rows: SignoffQueueRow[];
  levels: DashboardLevelOption[];
  emptyMessage?: string;
  footer?: ReactNode;
}) {
  const levelByCode = new Map(levels.map((l) => [l.code, l]));
  return (
    <div className="mt-8 rounded-lg border border-border bg-surface p-5">
      <h2 className="font-medium text-ink"><Tx>{title}</Tx></h2>
      <p className="mt-1 text-sm text-muted"><Tx>{description}</Tx></p>
      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const initial = row.activity.trim().charAt(0).toUpperCase() || "?";
          const level = levelByCode.get(row.intervention);
          return (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-xs font-semibold text-burgundy">
                  {initial}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={toneForLevel(level)}>{level?.label ?? row.intervention}</Badge>
                    <span className="truncate text-ink">{row.activity}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {row.itpNumber} — {row.itpTitle}
                    {row.when && <span className="ms-2">{row.when}</span>}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <SignoffCell
                  progressId={row.id}
                  isBlocking={level?.is_blocking ?? false}
                  status={row.status}
                  notifiedAt={null}
                  noticeHours={null}
                  canSignOff
                  isJagsStaff={false}
                />
                <Link
                  href={`/inspect/itps/${row.itpId}`}
                  className="text-xs font-medium text-burgundy hover:underline"
                >
                  <Tx>View ITP →</Tx>
                </Link>
              </div>
            </li>
          );
        })}
        {rows.length === 0 && emptyMessage && <li className="text-sm text-muted">{emptyMessage}</li>}
      </ul>
      {footer}
    </div>
  );
}
