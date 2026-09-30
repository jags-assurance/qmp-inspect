"use client";

import { useState } from "react";
import Link from "next/link";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { PageGuide } from "@/components/domain/page-guide";
import { ProposalReviewForm } from "./itp-master/proposals/proposal-review-form";

export interface PendingProposalItem {
  id: string;
  title: string;
  sourceItpId: string | null;
  sourceItpLabel: string | null;
  submittedOn: string;
}

export interface OpenNcrItem {
  id: string;
  ncrNumber: string;
  severity: "minor_ncr" | "major_ncr";
  createdAt: string;
  projectLabel: string;
}

export interface OverdueHoldPointItem {
  id: string;
  activity: string;
  itpNumber: string;
  projectLabel: string;
  daysOpen: number;
}

export interface RecentActivityItem {
  id: string;
  summary: string;
  actorName: string | null;
  projectLabel: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB");
}

export interface OrgPortfolioItem {
  id: string;
  name: string;
  engagementMode: string;
  activeProjects: number;
  openNcrs: number;
  /** This org's real active projects, for the inline "expand to see projects" row below —
   *  not just the aggregate counts above. */
  projects: { id: string; projectNumber: string; name: string; openNcrs: number }[];
}

const ENGAGEMENT_MODE_LABEL: Record<string, string> = {
  jags_led: "JAGS-led",
  co_branded: "Co-branded",
  white_label: "White-label",
};

// Plain-language "what to do here" guide — folded into the page's own Guide popover instead of an
// always-open box on the dashboard body (the box duplicated what "Guide" already exists for, and
// took up space above the fold on every visit, not just the first). Same treatment applied to
// Inspector and External-party dashboards.
const ADMIN_GUIDE: string[] = [
  "You oversee the whole client portfolio, not individual field work — see \"Your organisations\" below for every org your access reaches, with their active projects and open NCRs.",
  "Inspectors can propose new or updated Master Library ITP templates, but only you can approve them — see \"Master Library proposals awaiting review\" below.",
  "Use \"New project\" to onboard a client's next project once their organisation and users are set up.",
  "You have full access across every project and organisation you can see — use it to unblock issues Inspectors or external parties can't resolve themselves.",
];

/**
 * Third and last of the role-by-role dashboard passes. No dedicated mockup exists for this one
 * (the reference set only covers Inspector and the client-facing KPI view), so it follows the same
 * visual system the other two established — icon-badge stat cards, real DataTables with status
 * chips — rather than a generic layout. Portfolio/strategic in scope, matching what an Admin
 * actually does day to day: onboarding clients, approving Master Library proposals, keeping an eye
 * on the whole book of business rather than running field work themselves.
 */
export function AdminDashboard({
  firstName,
  today,
  activeProjects,
  activeItps,
  pendingInspections,
  openNcrs,
  pendingProposals,
  orgPortfolio,
  recentActivity,
  openNcrItems,
  overdueHoldPointItems,
}: {
  firstName: string;
  today: string;
  activeProjects: number;
  activeItps: number;
  pendingInspections: number;
  openNcrs: number;
  pendingProposals: PendingProposalItem[];
  orgPortfolio: OrgPortfolioItem[];
  recentActivity: RecentActivityItem[];
  openNcrItems: OpenNcrItem[];
  overdueHoldPointItems: OverdueHoldPointItem[];
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // Redesign (new purpose: less page-hopping, more in place): reviewing a proposal used to mean
  // navigating to /inspect/itp-master/proposals — same "expand inline instead of leaving the page"
  // pattern already applied to the NCR raise flow (Observations) and punch-list resolve/verify.
  // Only one row's form is open at a time, closing on submit via key remount below.
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            {greeting}, {firstName}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">JAGS Admin Overview</h1>
            <PageGuide
              title="JAGS Admin Overview — how this works"
              points={[
                "This view only renders for JAGS Admin — Inspectors and every external party each get their own dashboard instead, scoped to their own work.",
                "\"Pending proposals\" are submissions to the Tier-1 ITP template library — an Inspector can propose a new template or an update, but only an Admin can approve one.",
                "The portfolio table's active-project and open-NCR counts are computed per organisation from the same RLS-scoped rows every other page reads, not a separate summary table.",
                ...ADMIN_GUIDE,
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">{today} · Portfolio status across every client you have access to.</p>
        </div>
        <Link
          href="/inspect/projects/new"
          className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark"
        >
          New project
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard
          label="Active projects"
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
          label="Pending inspections"
          value={pendingInspections}
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
          label="Library proposals"
          value={pendingProposals.length}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-warning/10 text-warning">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <rect x="4" y="3" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 7h6M7 10h6M7 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
          }
        />
        <StatCard
          label="Overdue hold points"
          value={overdueHoldPointItems.length}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-danger/10 text-danger">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 6v4.5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          }
        />
      </div>

      {/* Window-grid layout (new purpose: every section as its own window, not one column of
          stacked panels) — three small real-time watchlists side by side on a wide screen (Overdue
          Hold Points / Open NCRs / Recent Activity), each independently scrollable so one long list
          never pushes the others down the page, with the two wide DataTables (Proposals,
          Organisations) as their own full-width windows below. */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {/* Real blocking sign-off points notified past their notice period, across every
            organisation — same logic the Inspector dashboard already computes for its own
            worklist, an Admin needs the portfolio-wide view of it too. */}
        <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Overdue hold points</h2>
          <p className="mt-1 text-xs text-muted">Blocking sign-offs notified past their notice period.</p>
          <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto">
            {overdueHoldPointItems.map((item) => (
              <li key={item.id} className="py-2 text-sm">
                <p className="text-ink">
                  <span className="doc-id mr-1 text-muted">{item.itpNumber}</span>
                  {item.activity}
                </p>
                <p className="mt-0.5 flex items-center justify-between text-xs">
                  <span className="text-muted">{item.projectLabel}</span>
                  <span className="font-semibold text-danger">{item.daysOpen}d overdue</span>
                </p>
              </li>
            ))}
            {overdueHoldPointItems.length === 0 && <li className="py-2 text-sm text-muted">No overdue hold points.</li>}
          </ul>
        </div>

        {/* The real open NCRs behind the KPI tile above, inline, instead of always needing a
            navigation to /inspect/ncrs just to see what they are. */}
        <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Open NCRs</h2>
          <p className="mt-1 text-xs text-muted">Minor and major, across every project you have access to.</p>
          <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto">
            {openNcrItems.map((item) => (
              <li key={item.id} className="py-2 text-sm">
                <p className="flex items-center gap-2">
                  <Badge tone={item.severity === "major_ncr" ? "danger" : "gold"}>
                    {item.severity === "major_ncr" ? "Major" : "Minor"}
                  </Badge>
                  <Link href={`/inspect/ncrs/${item.id}`} className="doc-id text-burgundy hover:underline">
                    {item.ncrNumber}
                  </Link>
                </p>
                <p className="mt-0.5 flex items-center justify-between text-xs text-muted">
                  <span>{item.projectLabel}</span>
                  <span>Raised {new Date(item.createdAt).toLocaleDateString("en-GB")}</span>
                </p>
              </li>
            ))}
            {openNcrItems.length === 0 && <li className="py-2 text-sm text-muted">No open NCRs.</li>}
          </ul>
          {openNcrs > openNcrItems.length && (
            <Link href="/inspect/ncrs" className="mt-2 text-xs text-burgundy hover:underline">
              See all {openNcrs} →
            </Link>
          )}
        </div>

        {/* Fieldwire-style "Activity" log — real audit_log events across every organisation this
            Admin can see, so what's happening on the portfolio is visible here directly instead of
            needing to open each project's own Audit Log page to find out. */}
        <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Recent activity</h2>
          <p className="mt-1 text-xs text-muted">Across every organisation your access reaches.</p>
          <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto">
            {recentActivity.map((event) => (
              <li key={event.id} className="py-2 text-sm">
                <p className="text-ink">
                  {event.actorName && <span className="font-medium">{event.actorName}</span>}
                  {event.actorName ? " — " : ""}
                  {event.summary}
                </p>
                <p className="mt-0.5 flex items-center justify-between text-xs text-muted">
                  <span>{event.projectLabel ?? "—"}</span>
                  <span>{timeAgo(event.createdAt)}</span>
                </p>
              </li>
            ))}
            {recentActivity.length === 0 && <li className="py-2 text-sm text-muted">No recent activity.</li>}
          </ul>
        </div>
      </div>

      {/* Full-width window below the 3-up grid — a wide DataTable (5 columns plus the inline
          review form) reads better at full width than squeezed into one of three small panes. */}
      {pendingProposals.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-ink">Master Library proposals awaiting review</h2>
              <p className="mt-1 text-sm text-muted">Submitted by staff, waiting on your decision.</p>
            </div>
            <Link href="/inspect/itp-master/proposals" className="text-sm font-medium text-burgundy hover:underline">
              View all →
            </Link>
          </div>
          <div className="mt-3">
            <DataTable
              rows={pendingProposals}
              searchPlaceholder="Search proposals…"
              searchKeys={(r) => `${r.title} ${r.sourceItpLabel ?? ""}`}
              emptyMessage="No pending proposals."
              columns={[
                { key: "title", header: "Proposal", render: (r) => r.title },
                {
                  key: "source",
                  header: "Source ITP",
                  render: (r) =>
                    r.sourceItpId ? (
                      <Link href={`/inspect/itps/${r.sourceItpId}`} className="text-burgundy hover:underline">
                        {r.sourceItpLabel}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                },
                {
                  key: "submitted",
                  header: "Submitted",
                  render: (r) => <span className="text-muted">{new Date(r.submittedOn).toLocaleDateString("en-GB")}</span>,
                },
                { key: "status", header: "Status", render: () => <Badge tone="warning">Pending review</Badge> },
                {
                  key: "action",
                  header: "",
                  render: (r) =>
                    expandedProposalId === r.id ? (
                      <div className="min-w-64">
                        <ProposalReviewForm proposalId={r.id} />
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExpandedProposalId(r.id)}
                        className="font-medium text-burgundy hover:underline"
                      >
                        Review
                      </button>
                    ),
                },
              ]}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            <Link href="/inspect/itp-master/proposals" className="text-burgundy hover:underline">
              Open the full proposals queue →
            </Link>{" "}
            if you need to see the source ITP for one of these.
          </p>
        </div>
      )}

      {/* Another full-width window — same reasoning as Proposals above. */}
      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-medium text-ink">Your organisations</h2>
        <p className="mt-1 text-sm text-muted">
          Visible here only because your access grants reach them — this list is the tenant isolation
          check made visible, with each client&apos;s real portfolio numbers.
        </p>
        <div className="mt-3">
          <DataTable
            rows={orgPortfolio}
            searchPlaceholder="Search organisations…"
            searchKeys={(r) => r.name}
            emptyMessage="No organisations are visible to your account yet."
            columns={[
              {
                key: "name",
                header: "Organisation",
                render: (r) => (
                  <Link href={`/inspect/projects?org=${r.id}`} className="text-burgundy hover:underline">
                    {r.name}
                  </Link>
                ),
              },
              {
                key: "mode",
                header: "Engagement mode",
                render: (r) => <span className="text-muted">{ENGAGEMENT_MODE_LABEL[r.engagementMode] ?? r.engagementMode}</span>,
              },
              {
                key: "activeProjects",
                header: "Active projects",
                render: (r) =>
                  r.activeProjects === 0 ? (
                    <span className="text-muted">0</span>
                  ) : expandedOrgId === r.id ? (
                    <div className="min-w-56">
                      <ul className="space-y-1">
                        {r.projects.map((p) => (
                          <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                            <Link href={`/inspect/projects/${p.id}`} className="truncate text-burgundy hover:underline">
                              {p.projectNumber} — {p.name}
                            </Link>
                            {p.openNcrs > 0 && <Badge tone="danger">{p.openNcrs}</Badge>}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => setExpandedOrgId(null)}
                        className="mt-1.5 text-xs text-muted hover:text-ink"
                      >
                        Collapse
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setExpandedOrgId(r.id)}
                      className="font-medium text-burgundy hover:underline"
                    >
                      {r.activeProjects} →
                    </button>
                  ),
              },
              {
                key: "ncrs",
                header: "Open NCRs",
                render: (r) => (r.openNcrs > 0 ? <Badge tone="danger">{r.openNcrs}</Badge> : <span className="text-muted">0</span>),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
