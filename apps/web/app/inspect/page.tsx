import Link from "next/link";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui/stat-card";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type ActivitySignoffProgressRow } from "@/lib/signoff/db-types";
import { ITP_MASTER_PROPOSALS_TABLE } from "@/lib/itp-master/types";
import { CHECKLIST_TEMPLATES_TABLE, INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import { PendingActionsTable } from "@/components/domain/pending-actions-table";

interface PendingSignoffRow {
  id: string;
  itp_item_id: ActivitySignoffProgressRow["itp_item_id"];
  intervention: ActivitySignoffProgressRow["intervention"];
  status: ActivitySignoffProgressRow["status"];
  notified_at: ActivitySignoffProgressRow["notified_at"];
  itp_items: {
    activity: string;
    itp_sections: {
      itps: { id: string; itp_number: string; title: string } | null;
    } | null;
  } | null;
}

// Small relative-time label ("18 min ago", "3 hrs ago", "Yesterday") computed from a real
// timestamp already on the row (notified_at) — no fabricated data.
function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/**
 * Every role sees the same shell (stat cards + org list) but with real, RLS-scoped numbers instead
 * of Phase 0's hardcoded zeros, plus a role-appropriate heading and an "awaiting your sign-off"
 * panel for anyone (staff or external party) actually on the hook for one. This intentionally
 * doesn't fork into separate page components per role — the underlying queries are identical
 * (RLS decides what rows come back), only the heading text, subtitle, and whether the sign-off
 * panel appears change.
 */
export default async function InspectDashboardPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name, engagement_mode")
    .order("name");

  const [
    { count: activeProjects },
    { count: activeItps },
    { count: pendingInspections },
    { count: openNcrs },
  ] = await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("itps").select("id", { count: "exact", head: true }).in("status", ["approved", "client_accepted"]),
    supabase.from("inspection_records").select("id", { count: "exact", head: true }).is("overall_result", null),
    supabase.from("ncrs").select("id", { count: "exact", head: true }).neq("status", "closed"),
  ]);

  // A user's own project_parties link (see lib/signoff/actions.ts's canSignOffForParty) is what
  // "awaiting your sign-off" actually means for an external party; for JAGS staff (who can
  // countersign any party) it's less meaningful, so the panel only renders for a linked party.
  const { data: ownParties } = await supabase
    .from("project_parties")
    .select("id, name")
    .eq("user_id", session.userId)
    .returns<{ id: string; name: string }[]>();

  let pendingSignoffs: PendingSignoffRow[] = [];
  if (ownParties && ownParties.length > 0) {
    const { data } = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select("id, intervention, status, notified_at, itp_items(activity, itp_sections(itps(id, itp_number, title)))")
      .in(
        "project_party_id",
        ownParties.map((p) => p.id)
      )
      .in("status", ["pending", "notified"])
      .limit(5)
      .returns<PendingSignoffRow[]>();
    pendingSignoffs = data ?? [];
  }

  // A client's own action isn't signing off an intervention grid cell (that's the contractor/
  // subcontractor/TPI's job) — it's the whole-ITP "Accept" step once JAGS has approved it. Only
  // meaningful for the party whose grant.role is literally 'client' (matches project_parties.party_type),
  // not every non-staff party.
  const isClientRole = !session.isJagsStaff && session.grants.some((g) => g.role === "client");
  const isMainContractorRole = !session.isJagsStaff && session.grants.some((g) => g.role === "main_contractor");
  let itpsAwaitingAcceptance: { id: string; itp_number: string; title: string }[] = [];
  if (isClientRole) {
    const { data } = await supabase
      .from("itps")
      .select("id, itp_number, title")
      .eq("status", "approved")
      .limit(5)
      .returns<{ id: string; itp_number: string; title: string }[]>();
    itpsAwaitingAcceptance = data ?? [];
  }

  // Main Contractor "review subcontractor work" panel: a Main Contractor's real queue item is an
  // activity where a subcontractor has already done their part (signed off their own H/W/R/S cell)
  // but the Main Contractor's own cell on that SAME activity is still pending/notified — i.e. it's
  // genuinely their turn to review. There's no explicit "raised for review" state in the schema
  // beyond activity_signoff_progress's own status machine, so this is a simplification: it reads
  // "subcontractor signed_off + main_contractor pending/notified on the same itp_item" as "work
  // awaiting main contractor review," rather than modelling a dedicated review/handoff state. That
  // undercounts a case where a subcontractor party has no intervention row at all on the activity
  // (nothing to detect), and overcounts one where the two parties' sign-offs are unrelated in intent
  // but happen to land on the same activity — both acceptable given no richer state exists to query.
  let workAwaitingReview: PendingSignoffRow[] = [];
  if (isMainContractorRole) {
    const { data: ownMcParties } = await supabase
      .from("project_parties")
      .select("id, project_id")
      .eq("user_id", session.userId)
      .eq("party_type", "main_contractor")
      .returns<{ id: string; project_id: string }[]>();

    if (ownMcParties && ownMcParties.length > 0) {
      const { data: mcPending } = await supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .select("id, itp_item_id, intervention, status, notified_at, itp_items(activity, itp_sections(itps(id, itp_number, title)))")
        .in(
          "project_party_id",
          ownMcParties.map((p) => p.id)
        )
        .in("status", ["pending", "notified"])
        .returns<PendingSignoffRow[]>();

      const itemIds = [...new Set((mcPending ?? []).map((r) => r.itp_item_id).filter(Boolean))];
      if (itemIds.length > 0) {
        // Subcontractor rows on the same activities that have already been signed off — the
        // "subcontractor raised/self-inspected the item" half of the filter.
        const { data: subSignedOff } = await supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("itp_item_id, project_party_id, status")
          .in("itp_item_id", itemIds)
          .eq("status", "signed_off")
          .returns<{ itp_item_id: string; project_party_id: string; status: string }[]>();

        const subPartyIds = [...new Set((subSignedOff ?? []).map((r) => r.project_party_id))];
        const { data: subPartyRows } = subPartyIds.length
          ? await supabase
              .from("project_parties")
              .select("id, party_type")
              .in("id", subPartyIds)
              .eq("party_type", "subcontractor")
              .returns<{ id: string; party_type: string }[]>()
          : { data: [] as { id: string; party_type: string }[] };

        const subcontractorPartyIds = new Set((subPartyRows ?? []).map((p) => p.id));
        const itemsWithSubcontractorSignoff = new Set(
          (subSignedOff ?? []).filter((r) => subcontractorPartyIds.has(r.project_party_id)).map((r) => r.itp_item_id)
        );

        workAwaitingReview = (mcPending ?? [])
          .filter((row) => itemsWithSubcontractorSignoff.has(row.itp_item_id))
          .slice(0, 5);
      }
    }
  }

  // An Admin's own queue item: proposals to the Tier-1 library waiting on their decision (an
  // Inspector can submit one, per lib/itp-master/actions.ts, but only an Admin can approve it).
  let pendingProposalsCount = 0;
  if (isAdminStaff(session)) {
    const { count } = await supabase
      .from(ITP_MASTER_PROPOSALS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    pendingProposalsCount = count ?? 0;
  }

  // "My pending actions" (matches the prototype's Inspector Dashboard reference) — a real worklist
  // of checklists that either haven't been started yet or have a draft in progress, not just a
  // count. Scoped to Inspector rather than Admin: an Admin's dashboard stays portfolio/strategic
  // (see the proposals panel above), while an Inspector's is the operational one this mirrors.
  interface PendingActionRow {
    templateId: string;
    checklistNumber: string;
    activity: string;
    itpId: string;
    itpNumber: string;
    projectName: string;
    status: "not_started" | "in_progress";
    createdAt: string;
    ageDays: number;
  }
  // A checklist generated more than OVERDUE_DAYS ago with no response yet counts as overdue —
  // there's no separate "due date" concept in the schema, so age-since-generation is the closest
  // real signal (not a fabricated field).
  const OVERDUE_DAYS = 2;
  const today = new Date();
  const isSameDay = (iso: string) => {
    const d = new Date(iso);
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  };
  let pendingActions: PendingActionRow[] = [];
  const isInspector = session.isJagsStaff && !isAdminStaff(session);
  if (isInspector) {
    interface TemplateRow {
      id: string;
      checklist_number: string;
      created_at: string;
      itp_items: {
        activity: string;
        itp_sections: {
          itps: { id: string; itp_number: string; projects: { name: string } | null } | null;
        } | null;
      } | null;
    }
    const { data: templates } = await supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select("id, checklist_number, created_at, itp_items(activity, itp_sections(itps(id, itp_number, projects(name))))")
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<TemplateRow[]>();

    const templateIds = (templates ?? []).map((t) => t.id);
    const { data: records } = await supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("checklist_template_id, overall_result")
      .in("checklist_template_id", templateIds.length > 0 ? templateIds : ["00000000-0000-0000-0000-000000000000"])
      .returns<{ checklist_template_id: string | null; overall_result: string | null }[]>();

    const hasCompleted = new Set((records ?? []).filter((r) => r.overall_result !== null).map((r) => r.checklist_template_id));
    const hasDraft = new Set((records ?? []).filter((r) => r.overall_result === null).map((r) => r.checklist_template_id));

    pendingActions = (templates ?? [])
      .filter((t) => !hasCompleted.has(t.id))
      .map((t) => {
        const itp = t.itp_items?.itp_sections?.itps;
        const ageDays = Math.floor((today.getTime() - new Date(t.created_at).getTime()) / 86_400_000);
        return {
          templateId: t.id,
          checklistNumber: t.checklist_number,
          activity: t.itp_items?.activity ?? "Untitled activity",
          itpId: itp?.id ?? "",
          itpNumber: itp?.itp_number ?? "",
          projectName: itp?.projects?.name ?? "",
          status: (hasDraft.has(t.id) ? "in_progress" : "not_started") as "in_progress" | "not_started",
          createdAt: t.created_at,
          ageDays,
        };
      })
      .slice(0, 8);
  }

  const pendingToday = pendingActions.filter((a) => isSameDay(a.createdAt));
  const pendingOverdue = pendingActions.filter((a) => a.ageDays >= OVERDUE_DAYS);

  const heading = isAdminStaff(session)
    ? "JAGS Admin Overview"
    : session.isJagsStaff
      ? "Inspector Dashboard"
      : ownParties && ownParties.length > 0
        ? `${ownParties[0].name} Dashboard`
        : "Dashboard";

  const subtitle = session.isJagsStaff
    ? isAdminStaff(session)
      ? "Portfolio status across every client you have access to."
      : "Your day-to-day queue across every project you have access to."
    : "Status across the project(s) you're engaged on.";

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">{heading}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Active projects"
          value={activeProjects ?? 0}
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
          value={activeItps ?? 0}
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
          value={pendingInspections ?? 0}
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
          value={openNcrs ?? 0}
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

      {isInspector && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">My pending actions</h2>
          <p className="mt-1 text-sm text-muted">Checklists not yet started, or still in progress, across every project you have access to.</p>
          <div className="mt-4">
            <PendingActionsTable
              all={pendingActions}
              today={pendingToday}
              overdue={pendingOverdue}
            />
          </div>
        </div>
      )}

      {isAdminStaff(session) && pendingProposalsCount > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-ink">Master Library proposals awaiting review</h2>
              <p className="mt-1 text-sm text-muted">
                Submitted by staff, waiting on an Admin decision.
              </p>
            </div>
            <Link
              href="/inspect/itp-master/proposals"
              className="rounded-md border border-border bg-off-white px-3 py-1.5 text-sm font-medium hover:bg-surface"
            >
              Review {pendingProposalsCount} →
            </Link>
          </div>
        </div>
      )}

      {itpsAwaitingAcceptance.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">ITPs awaiting your acceptance</h2>
          <p className="mt-1 text-sm text-muted">
            JAGS has approved these — your acceptance is the last step before field work begins.
          </p>
          <ul className="mt-4 space-y-2">
            {itpsAwaitingAcceptance.map((itp) => (
              <li
                key={itp.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="text-ink">
                  {itp.itp_number} — {itp.title}
                </span>
                <Link href={`/inspect/itps/${itp.id}`} className="text-burgundy hover:underline">
                  Review & accept →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isMainContractorRole && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">Work awaiting your review</h2>
          <p className="mt-1 text-sm text-muted">
            Activities where a subcontractor has already signed off their part, and your own
            sign-off on the same activity is still pending or notified.
          </p>
          <ul className="mt-4 space-y-2">
            {workAwaitingReview.map((row) => {
              const itp = row.itp_items?.itp_sections?.itps;
              const activity = row.itp_items?.activity ?? "Untitled activity";
              const initial = activity.trim().charAt(0).toUpperCase() || "?";
              const when = timeAgo(row.notified_at);
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-xs font-semibold text-burgundy">
                      {initial}
                    </span>
                    <span className="min-w-0 truncate text-ink">
                      {row.intervention} · {activity}
                      {itp && (
                        <span className="text-muted">
                          {" "}
                          — {itp.itp_number} {itp.title}
                        </span>
                      )}
                      {when && <span className="ml-2 text-xs text-muted">{when}</span>}
                    </span>
                  </div>
                  {itp && (
                    <Link
                      href={`/inspect/itps/${itp.id}`}
                      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-burgundy hover:bg-off-white"
                    >
                      Review →
                    </Link>
                  )}
                </li>
              );
            })}
            {workAwaitingReview.length === 0 && (
              <li className="text-sm text-muted">Nothing awaiting your review right now.</li>
            )}
          </ul>
        </div>
      )}

      {ownParties && ownParties.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">Awaiting your sign-off</h2>
          <p className="mt-1 text-sm text-muted">
            Hold/Witness/Review/Surveillance points on your own party&apos;s column that still need
            a Notify or Sign off — only what your login is linked to, not the whole project.
          </p>
          <ul className="mt-4 space-y-2">
            {pendingSignoffs.map((row) => {
              const itp = row.itp_items?.itp_sections?.itps;
              const activity = row.itp_items?.activity ?? "Untitled activity";
              const initial = activity.trim().charAt(0).toUpperCase() || "?";
              const when = timeAgo(row.notified_at);
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-xs font-semibold text-burgundy">
                      {initial}
                    </span>
                    <span className="min-w-0 truncate text-ink">
                      {row.intervention} · {activity}
                      {itp && (
                        <span className="text-muted">
                          {" "}
                          — {itp.itp_number} {itp.title}
                        </span>
                      )}
                      {when && <span className="ml-2 text-xs text-muted">{when}</span>}
                    </span>
                  </div>
                  {itp && (
                    <Link
                      href={`/inspect/itps/${itp.id}`}
                      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-burgundy hover:bg-off-white"
                    >
                      Review →
                    </Link>
                  )}
                </li>
              );
            })}
            {pendingSignoffs.length === 0 && (
              <li className="text-sm text-muted">Nothing awaiting your sign-off right now.</li>
            )}
          </ul>
        </div>
      )}

      <div className="mt-8 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">Your organisations</h2>
        <p className="mt-1 text-sm text-muted">
          Visible here only because your access grants reach them — this list is the tenant
          isolation check made visible.
        </p>
        <ul className="mt-4 space-y-2">
          {(organizations ?? []).map((org) => (
            <li
              key={org.id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="text-ink">{org.name}</span>
              <span className="text-muted">{org.engagement_mode}</span>
            </li>
          ))}
          {(organizations ?? []).length === 0 && (
            <li className="text-sm text-muted">No organisations are visible to your account yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
