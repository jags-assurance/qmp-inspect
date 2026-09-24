"use client";

import Link from "next/link";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { PageGuide } from "@/components/domain/page-guide";

export interface PendingProposalItem {
  id: string;
  title: string;
  sourceItpId: string | null;
  sourceItpLabel: string | null;
  submittedOn: string;
}

export interface OrgPortfolioItem {
  id: string;
  name: string;
  engagementMode: string;
  activeProjects: number;
  openNcrs: number;
}

const ENGAGEMENT_MODE_LABEL: Record<string, string> = {
  jags_led: "JAGS-led",
  co_branded: "Co-branded",
  white_label: "White-label",
};

// Plain-language "what to do here" guide, matching the one added to the external-party dashboard
// (see ROLE_GUIDE in external-party-dashboard.tsx) — same reasoning applied to the Admin view: the
// panels alone don't spell out what an Admin's job actually is. Kept to short, concrete bullets tied
// to the panels this dashboard actually renders below.
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
}: {
  firstName: string;
  today: string;
  activeProjects: number;
  activeItps: number;
  pendingInspections: number;
  openNcrs: number;
  pendingProposals: PendingProposalItem[];
  orgPortfolio: OrgPortfolioItem[];
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
            <h1 className="text-2xl font-semibold text-ink">JAGS Admin Overview</h1>
            <PageGuide
              title="JAGS Admin Overview — how this works"
              points={[
                "This view only renders for JAGS Admin — Inspectors and every external party each get their own dashboard instead, scoped to their own work.",
                "\"Pending proposals\" are submissions to the Tier-1 ITP template library — an Inspector can propose a new template or an update, but only an Admin can approve one.",
                "The portfolio table's active-project and open-NCR counts are computed per organisation from the same RLS-scoped rows every other page reads, not a separate summary table.",
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

      <details className="mt-4 rounded-lg border border-gold/40 bg-gold/5 open:pb-4" open>
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-ink">
          Your role as JAGS Admin: what to do here
        </summary>
        <ul className="space-y-1.5 px-4 text-sm text-ink">
          {ADMIN_GUIDE.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-burgundy">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
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
          label="Open NCRs"
          value={openNcrs}
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
      </div>

      {pendingProposals.length > 0 && (
        <div className="mt-8">
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
                  render: (r) => <span className="text-muted">{new Date(r.submittedOn).toLocaleDateString()}</span>,
                },
                { key: "status", header: "Status", render: () => <Badge tone="warning">Pending review</Badge> },
                {
                  key: "action",
                  header: "",
                  render: () => (
                    <Link href="/inspect/itp-master/proposals" className="font-medium text-burgundy hover:underline">
                      Review →
                    </Link>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      <div className="mt-8">
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
              { key: "name", header: "Organisation", render: (r) => <span className="text-ink">{r.name}</span> },
              {
                key: "mode",
                header: "Engagement mode",
                render: (r) => <span className="text-muted">{ENGAGEMENT_MODE_LABEL[r.engagementMode] ?? r.engagementMode}</span>,
              },
              { key: "projects", header: "Active projects", render: (r) => r.activeProjects },
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
