"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";

const INTERVENTION_TONE: Record<"H" | "W" | "R" | "S", "danger" | "warning" | "info" | "neutral"> = {
  H: "danger",
  W: "warning",
  R: "neutral",
  S: "info",
};

const INTERVENTION_LABEL: Record<"H" | "W" | "R" | "S", string> = {
  H: "Hold",
  W: "Witness",
  R: "Review",
  S: "Surveillance",
};

const ROLE_LABEL: Record<string, string> = {
  client: "Client",
  subcontractor: "Subcontractor",
  main_contractor: "Main Contractor",
  tpi_lab: "TPI / Lab",
};

export interface SignoffQueueRow {
  id: string;
  intervention: "H" | "W" | "R" | "S";
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
  itpsAwaitingAcceptance,
  workAwaitingReview,
  pendingSignoffs,
}: {
  orgName: string | null;
  /** project_parties.party_type of the user's own linked party, e.g. "client" | "subcontractor". */
  roleKey: string | null;
  today: string;
  activeProjects: number;
  activeItps: number;
  pendingInspections: number;
  openNcrs: number;
  itpsAwaitingAcceptance: ItpAwaitingAcceptanceRow[];
  workAwaitingReview: SignoffQueueRow[];
  pendingSignoffs: SignoffQueueRow[];
}) {
  const roleLabel = roleKey ? (ROLE_LABEL[roleKey] ?? roleKey) : "Project party";
  const needsAttention = itpsAwaitingAcceptance.length + workAwaitingReview.length + pendingSignoffs.length;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">{orgName ? `${orgName} Dashboard` : "Dashboard"}</h1>
      <p className="mt-1 text-sm text-muted">
        {roleLabel} · {today}
      </p>

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
          label="Needs your attention"
          value={needsAttention}
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

      {itpsAwaitingAcceptance.length > 0 && (
        <div className="mt-8">
          <h2 className="font-medium text-ink">ITPs awaiting your acceptance</h2>
          <p className="mt-1 text-sm text-muted">
            JAGS has approved these — your acceptance is the last step before field work begins.
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
                { key: "status", header: "Status", render: () => <Badge tone="gold">Awaiting acceptance</Badge> },
                {
                  key: "action",
                  header: "",
                  render: (r) => (
                    <Link href={`/inspect/itps/${r.id}`} className="font-medium text-burgundy hover:underline">
                      Review & accept →
                    </Link>
                  ),
                },
              ]}
            />
          </div>
        </div>
      )}

      {workAwaitingReview.length > 0 && (
        <SignoffQueuePanel
          title="Work awaiting your review"
          description="Activities where a subcontractor has already signed off their part, and your own sign-off on the same activity is still pending or notified."
          rows={workAwaitingReview}
        />
      )}

      <SignoffQueuePanel
        title="Awaiting your sign-off"
        description="Hold / Witness / Review / Surveillance points on your own party's column that still need a Notify or Sign off — only what your login is linked to, not the whole project."
        rows={pendingSignoffs}
        emptyMessage="Nothing awaiting your sign-off right now."
      />
    </div>
  );
}

function SignoffQueuePanel({
  title,
  description,
  rows,
  emptyMessage,
}: {
  title: string;
  description: string;
  rows: SignoffQueueRow[];
  emptyMessage?: string;
}) {
  return (
    <div className="mt-8 rounded-lg border border-border bg-surface p-5">
      <h2 className="font-medium text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const initial = row.activity.trim().charAt(0).toUpperCase() || "?";
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
                    <Badge tone={INTERVENTION_TONE[row.intervention]}>{INTERVENTION_LABEL[row.intervention]}</Badge>
                    <span className="truncate text-ink">{row.activity}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    {row.itpNumber} — {row.itpTitle}
                    {row.when && <span className="ml-2">{row.when}</span>}
                  </div>
                </div>
              </div>
              <Link
                href={`/inspect/itps/${row.itpId}`}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-burgundy hover:bg-off-white"
              >
                Review →
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && emptyMessage && <li className="text-sm text-muted">{emptyMessage}</li>}
      </ul>
    </div>
  );
}
