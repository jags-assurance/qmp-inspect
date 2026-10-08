"use client";

import { Tx } from "@/components/domain/tx";
import type { ReactNode } from "react";
import Link from "next/link";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SidePanel, useUrlPanel } from "@/components/ui/side-panel";
import { Watchlist } from "@/components/ui/watchlist";
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
  description: string;
  dueDate: string | null;
  status: string;
}

export interface RecentActivityItem {
  id: string;
  summary: string;
  actorName: string | null;
  projectLabel: string | null;
  createdAt: string;
  /** Where the event's own record lives; the row opens it directly. */
  href: string | null;
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
  openNcrTotal,
  pendingProposalTotal,
  pendingProposals,
  orgPortfolio,
  recentActivity,
  openNcrItems,
  overdueHoldsTile,
  overdueHoldsCard,
  clearancesWidget = null,
}: {
  /** Streamed server widget: calibrations / certificates that are lapsed or lapsing. */
  clearancesWidget?: ReactNode;
  firstName: string;
  today: string;
  activeProjects: number;
  activeItps: number;
  pendingInspections: number;
  /** True count of open minor/major NCRs (the list below is a capped slice of it). */
  openNcrTotal: number;
  /** True count of pending proposals (the table below is a capped slice of it). */
  pendingProposalTotal: number;
  pendingProposals: PendingProposalItem[];
  orgPortfolio: OrgPortfolioItem[];
  recentActivity: RecentActivityItem[];
  openNcrItems: OpenNcrItem[];
  /** Streamed server pieces (see admin-overdue-holds.tsx) so the slowest query doesn't block the page. */
  overdueHoldsTile: ReactNode;
  overdueHoldsCard: ReactNode;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // One shared side panel for every "open this row" action on the page (proposal review, NCR
  // preview, organisation projects). State lives in the URL (?panel=kind:id) so a panel is
  // deep-linkable, survives refresh and the Back button closes it; the list stays in place behind it.
  const panel = useUrlPanel("panel");
  const [panelKind, panelId] = (panel.value ?? "").split(":");
  const openProposal = panelKind === "proposal" ? pendingProposals.find((p) => p.id === panelId) : undefined;
  const openNcr = panelKind === "ncr" ? openNcrItems.find((n) => n.id === panelId) : undefined;
  const openOrg = panelKind === "org" ? orgPortfolio.find((o) => o.id === panelId) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted" suppressHydrationWarning>
            {greeting}, {firstName}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink"><Tx>JAGS Admin Overview</Tx></h1>
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

      {/* Ordered by urgency — what needs action today first, reference counts (projects, ITPs) last. */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {overdueHoldsTile}
        <StatCard
          label="Open NCRs"
          value={openNcrTotal}
          href="/inspect/ncrs"
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-danger/10 text-danger">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path d="M10 3l7.5 13h-15L10 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M10 8.5v3.5M10 14.2v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
          }
        />
        <StatCard
          label="Library proposals"
          value={pendingProposalTotal}
          href="/inspect/itp-master/proposals"
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
      </div>

      {/* Window-grid layout (new purpose: every section as its own window, not one column of
          stacked panels) — three small real-time watchlists side by side on a wide screen (Overdue
          Hold Points / Open NCRs / Recent Activity), each independently scrollable so one long list
          never pushes the others down the page, with the two wide DataTables (Proposals,
          Organisations) as their own full-width windows below. */}
      {clearancesWidget}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {overdueHoldsCard}

        <Watchlist
          anchorId="open-ncrs"
          title="Open NCRs"
          description="Minor and major, across every project you have access to."
          items={openNcrItems}
          total={openNcrTotal}
          seeAllHref="/inspect/ncrs"
          emptyText="No open NCRs."
          renderItem={(item) => (
            <Link href={`/inspect/ncrs/${item.id}`} className="block w-full rounded-md px-1.5 py-1 text-start hover:bg-off-white">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge tone={item.severity === "major_ncr" ? "danger" : "gold"}>
                  {item.severity === "major_ncr" ? "Major" : "Minor"}
                </Badge>
                <span className="doc-id text-burgundy">{item.ncrNumber}</span>
              </span>
              {item.description && <span className="mt-1 line-clamp-2 block text-xs text-ink">{item.description}</span>}
              <span className="mt-1 flex items-center justify-between gap-3 text-xs text-muted">
                <span className="min-w-0 truncate" title={item.projectLabel}>
                  {item.projectLabel}
                </span>
                <span className="shrink-0 whitespace-nowrap">Raised {new Date(item.createdAt).toLocaleDateString("en-GB")}</span>
              </span>
              <span className="mt-1 block text-xs font-medium text-burgundy">Open NCR →</span>
            </Link>
          )}
        />

        <Watchlist
          title="Recent activity"
          description="Across every organisation your access reaches."
          items={recentActivity}
          emptyText="No recent activity."
          renderItem={(event) => {
            const body = (
            <>
              <p className="text-ink">
                {event.actorName && <span className="font-medium">{event.actorName}</span>}
                {event.actorName ? " — " : ""}
                {event.summary}
              </p>
              <p className="mt-0.5 flex items-center justify-between gap-3 text-xs text-muted">
                <span className="min-w-0 truncate" title={event.projectLabel ?? undefined}>
                  {event.projectLabel ?? ""}
                </span>
                <span className="shrink-0 whitespace-nowrap" suppressHydrationWarning>
                  {timeAgo(event.createdAt)}
                </span>
              </p>
            </>
            );
            return event.href ? (
              <Link href={event.href} className="block rounded-md px-1.5 py-1 hover:bg-off-white">
                {body}
                <span className="mt-1 block text-xs font-medium text-burgundy">Open →</span>
              </Link>
            ) : (
              body
            );
          }}
        />
      </div>

      {/* Full-width window below the 3-up grid — a wide DataTable (5 columns plus the inline
          review form) reads better at full width than squeezed into one of three small panes. */}
      {pendingProposals.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-ink"><Tx>Master Library proposals awaiting review</Tx></h2>
              <p className="mt-1 text-sm text-muted">Submitted by staff, waiting on your decision.</p>
            </div>
            <Link href="/inspect/itp-master/proposals" className="text-sm font-medium text-burgundy hover:underline">
              View all{pendingProposalTotal > pendingProposals.length ? ` ${pendingProposalTotal}` : ""} →
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
                  render: (r) => (
                    <button
                      type="button"
                      onClick={() => panel.open(`proposal:${r.id}`)}
                      className="inline-flex min-h-8 items-center font-medium text-burgundy hover:underline"
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
        <h2 className="font-medium text-ink"><Tx>Your organisations</Tx></h2>
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
                  ) : (
                    <Link href={`/inspect/projects?org=${r.id}`} className="inline-flex min-h-8 items-center font-medium text-burgundy hover:underline">
                      {r.activeProjects} project{r.activeProjects === 1 ? "" : "s"} →
                    </Link>
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

      <SidePanel
        open={!!openProposal}
        onClose={panel.close}
        title="Review proposal"
        description={openProposal?.title}
        guardUnsaved={false}
      >
        {openProposal && (
          <div className="mt-4 text-sm">
            <p className="text-muted">Submitted {new Date(openProposal.submittedOn).toLocaleDateString("en-GB")}</p>
            {openProposal.sourceItpId && (
              <p className="mt-2">
                Source ITP:{" "}
                <Link href={`/inspect/itps/${openProposal.sourceItpId}`} className="text-burgundy hover:underline">
                  {openProposal.sourceItpLabel}
                </Link>
              </p>
            )}
            <ProposalReviewForm proposalId={openProposal.id} />
          </div>
        )}
      </SidePanel>

      <SidePanel open={!!openNcr} onClose={panel.close} title={openNcr?.ncrNumber ?? "NCR"} guardUnsaved={false}>
        {openNcr && (
          <div className="mt-4 space-y-3 text-sm">
            <p className="flex items-center gap-2">
              <Badge tone={openNcr.severity === "major_ncr" ? "danger" : "gold"}>
                {openNcr.severity === "major_ncr" ? "Major NCR" : "Minor NCR"}
              </Badge>
              <span className="text-muted capitalize">{openNcr.status.replace(/_/g, " ")}</span>
            </p>
            <p className="text-ink">{openNcr.description}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Project</dt>
              <dd className="text-ink">{openNcr.projectLabel}</dd>
              <dt className="text-muted">Raised</dt>
              <dd className="text-ink">{new Date(openNcr.createdAt).toLocaleDateString("en-GB")}</dd>
              <dt className="text-muted">Due</dt>
              <dd className="text-ink">{openNcr.dueDate ? new Date(openNcr.dueDate).toLocaleDateString("en-GB") : "—"}</dd>
            </dl>
            <Link
              href={`/inspect/ncrs/${openNcr.id}`}
              className="inline-flex min-h-11 items-center rounded-md bg-burgundy px-4 text-sm font-medium text-white hover:bg-burgundy-dark"
            >
              Open full NCR →
            </Link>
          </div>
        )}
      </SidePanel>

      <SidePanel
        open={!!openOrg}
        onClose={panel.close}
        title={openOrg?.name ?? "Organisation"}
        description={openOrg ? `${ENGAGEMENT_MODE_LABEL[openOrg.engagementMode] ?? openOrg.engagementMode} · ${openOrg.activeProjects} active project${openOrg.activeProjects === 1 ? "" : "s"}` : undefined}
        guardUnsaved={false}
      >
        {openOrg && (
          <div className="mt-4">
            <ul className="divide-y divide-border">
              {openOrg.projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/inspect/projects/${p.id}`} className="min-w-0 truncate text-burgundy hover:underline">
                    {p.projectNumber} — {p.name}
                  </Link>
                  {p.openNcrs > 0 && <Badge tone="danger">{p.openNcrs} NCR{p.openNcrs === 1 ? "" : "s"}</Badge>}
                </li>
              ))}
            </ul>
            <Link href={`/inspect/projects?org=${openOrg.id}`} className="mt-3 inline-block text-sm text-burgundy hover:underline">
              Open in Projects →
            </Link>
          </div>
        )}
      </SidePanel>
    </div>
  );
}
