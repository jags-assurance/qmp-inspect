import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ACTIVITY_SIGNOFF_PROGRESS_TABLE,
  DEFAULT_NOTICE_PERIOD_HOURS,
  NOTICE_PERIOD_CONFIGS_TABLE,
  type ActivitySignoffProgressRow,
} from "@/lib/signoff/db-types";
import { ITP_MASTER_PROPOSALS_TABLE } from "@/lib/itp-master/types";
import { AUDIT_LOG_TABLE } from "@/lib/audit/types";
import { INTERVENTION_LEVEL_TYPES_TABLE, type InterventionLevelTypeRow } from "@/lib/intervention-levels/types";
import { CHECKLIST_TEMPLATES_TABLE, INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import { sortByDynamicPriority } from "@/lib/checklists/priority-routing";
import { STANDALONE_ASSIGNMENTS } from "@/lib/standalone/types";
import type { AssignmentType, AssignmentStatus } from "@/lib/standalone/actions";
import type { PendingActionItem } from "@/components/domain/pending-actions-table";
import { ExternalPartyDashboard, type SignoffQueueRow } from "./external-party-dashboard";
import { InspectorDashboard } from "./inspector-dashboard";
import { Suspense } from "react";
import { AdminDashboard } from "./admin-dashboard";
import { AdminTodayWithHolds, OverdueHoldsCard, OverdueHoldsTile } from "./admin-overdue-holds";
import { TodayQueue } from "@/components/domain/today-queue";
import { buildAdminToday } from "@/lib/dashboard/today";
import { WatchlistSkeleton } from "@/components/ui/watchlist";
import { StatCard } from "@/components/ui/stat-card";
import type { OrgHealth } from "@/lib/dashboard/widgets";

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
 * One route, three real dashboards: every query below is computed once (RLS already scopes what
 * comes back per login), then handed to whichever role-specific view actually matches the session
 * — ExternalPartyDashboard (client/subcontractor/main contractor/TPI-lab), InspectorDashboard, or
 * the JAGS Admin view still rendered inline below. Each was designed against its own UI reference
 * screen rather than sharing one generic layout, so they're built and reviewed one at a time.
 */
export default async function InspectDashboardPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // These six queries are mutually independent (none consumes another's result), so they're fired
  // together as a single Promise.all instead of four separate sequential round-trips.
  const [
    { data: organizations },
    { count: activeProjects },
    { count: activeItps },
    { count: pendingInspections },
    { count: openNcrs },
    { data: ownParties },
  ] = await Promise.all([
    supabase.from("organizations").select("id, name, engagement_mode").order("name"),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("itps").select("id", { count: "exact", head: true }).in("status", ["approved", "client_accepted"]),
    supabase.from("inspection_records").select("id", { count: "exact", head: true }).is("overall_result", null),
    // Round-table finding: this used to count open Observations (severity='observation') into the
    // "Open NCRs" stat card too — honest now that the NCR and Observation registers are shown as
    // two distinct registers elsewhere in this app (see observations/page.tsx's own header comment).
    supabase.from("ncrs").select("id", { count: "exact", head: true }).neq("status", "closed").neq("severity", "observation"),
    // A user's own project_parties link (see lib/signoff/actions.ts's canSignOffForParty) is what
    // "awaiting your sign-off" actually means for an external party; for JAGS staff (who can
    // countersign any party) it's less meaningful, so the panel only renders for a linked party.
    supabase
      .from("project_parties")
      .select("id, name, party_type, project_id, projects(organization_id, name)")
      .eq("user_id", session.userId)
      .returns<
        { id: string; name: string; party_type: string; project_id: string; projects: { organization_id: string; name: string } | null }[]
      >(),
  ]);

  // Round-table finding: an external party's dashboard had no direct path to a project's PDF/Excel
  // reports, data book or activity timeline — only the stat cards and sign-off queues above. Those
  // pages already exist and are already RLS-scoped to this party (see the project hub page's own
  // HubCards), they just weren't surfaced anywhere before the party drilled into a specific project.
  // Deduplicated by project_id since one party can be linked under more than one project_parties row.
  const myProjects = [
    ...new Map(
      (ownParties ?? [])
        .filter((p) => p.project_id && p.projects?.name)
        .map((p) => [p.project_id, { id: p.project_id, name: p.projects!.name }])
    ).values(),
  ];

  // This party's organisation's configured intervention levels (supabase/migrations/
  // 20260917090000_configurable_intervention_levels.sql) — used below to give ExternalPartyDashboard
  // real labels/tones for a custom level instead of the old hardcoded H/W/R/S maps. An external
  // party is scoped to one organisation in practice (same assumption ownParties[0].name already
  // makes for orgName below), so the first linked party's org is used.
  const ownOrgId = ownParties?.[0]?.projects?.organization_id ?? null;

  // Perf: everything an external party's dashboard needs beyond ownParties is independent of each
  // other (level types, own sign-off queue, client "awaiting acceptance", main-contractor review
  // chain) — they used to run as four sequential awaits. They're declared as loaders here and run
  // together in one Promise.all below, so the page waits for the slowest chain, not the sum.
  const loadOwnOrgLevelTypes = async () => {
    if (!ownOrgId) return [] as Pick<InterventionLevelTypeRow, "code" | "label" | "sort_order" | "is_blocking">[];
    const { data } = await supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("code, label, sort_order, is_blocking")
      .eq("organization_id", ownOrgId)
      .order("sort_order")
      .returns<Pick<InterventionLevelTypeRow, "code" | "label" | "sort_order" | "is_blocking">[]>();
    return data ?? [];
  };

  const loadPendingSignoffs = async (): Promise<PendingSignoffRow[]> => {
    if (!ownParties || ownParties.length === 0) return [];
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
    return data ?? [];
  };

  // A client's own action isn't signing off an intervention grid cell (that's the contractor/
  // subcontractor/TPI's job) — it's the whole-ITP "Accept" step once JAGS has approved it. Only
  // meaningful for the party whose grant.role is literally 'client' (matches project_parties.party_type),
  // not every non-staff party.
  const isClientRole = !session.isJagsStaff && session.grants.some((g) => g.role === "client");
  const isMainContractorRole = !session.isJagsStaff && session.grants.some((g) => g.role === "main_contractor");
  type AwaitingAcceptanceRow = { id: string; itp_number: string; title: string; projects: { name: string } | null };
  const loadItpsAwaitingAcceptance = async (): Promise<AwaitingAcceptanceRow[]> => {
    if (!isClientRole) return [];
    const { data } = await supabase
      .from("itps")
      .select("id, itp_number, title, projects(name)")
      .eq("status", "approved")
      .limit(5)
      .returns<AwaitingAcceptanceRow[]>();
    return data ?? [];
  };

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
  const loadWorkAwaitingReview = async (): Promise<PendingSignoffRow[]> => {
    if (!isMainContractorRole) return [];
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

        return (mcPending ?? [])
          .filter((row) => itemsWithSubcontractorSignoff.has(row.itp_item_id))
          .slice(0, 5);
      }
    }
    return [];
  };

  interface AssignedNcrRow {
    id: string;
    ncr_number: string;
    severity: "observation" | "minor_ncr" | "major_ncr";
    description: string;
    due_date: string | null;
    projects: { name: string } | null;
  }
  const loadNcrsAssignedToMe = async (): Promise<AssignedNcrRow[]> => {
    if (session.isJagsStaff) return [];
    // Mirrors the sign-off queue's own reasoning: a notification is how a party first hears about
    // an assigned NCR, but if it's missed or dismissed there was previously no dashboard path back
    // to it — only the aggregate "Open NCRs" count, which isn't actionable.
    const { data } = await supabase
      .from("ncrs" as never)
      .select("id, ncr_number, severity, description, due_date, projects(name)")
      .eq("assigned_to", session.userId)
      .neq("status", "closed")
      .order("due_date", { nullsFirst: false })
      .limit(5)
      .returns<AssignedNcrRow[]>();
    return data ?? [];
  };

  // A client login whose own organisation is self-/client-managed runs that org's settings — they
  // get an organisation-health widget leading their dashboard (lib/dashboard/widgets.ts). Only the
  // cheap RLS-scoped head counts below run, and only for that role.
  const loadOrgHealth = async (): Promise<{ managesOwnOrg: boolean; orgHealth: OrgHealth | null }> => {
    if (session.isJagsStaff || !ownOrgId) return { managesOwnOrg: false, orgHealth: null };
    const { data: ownOrg } = await supabase
      .from("organizations")
      .select("engagement_scope")
      .eq("id", ownOrgId)
      .maybeSingle<{ engagement_scope: string | null }>();
    const managesOwnOrg = ownOrg?.engagement_scope === "self_managed" || ownOrg?.engagement_scope === "client_managed";
    if (!managesOwnOrg) return { managesOwnOrg, orgHealth: null };
    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ count: activeParties }, { count: partiesWithLogin }, { count: openPunchItems }, { count: overdueNcrs }] =
      await Promise.all([
        supabase.from("project_parties").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("project_parties").select("id", { count: "exact", head: true }).eq("is_active", true).not("user_id", "is", null),
        supabase.from("punch_list_items").select("id", { count: "exact", head: true }).neq("status", "closed"),
        supabase.from("ncrs").select("id", { count: "exact", head: true }).neq("status", "closed").lt("due_date", todayIso),
      ]);
    return {
      managesOwnOrg,
      orgHealth: {
        activeParties: activeParties ?? 0,
        partiesWithLogin: partiesWithLogin ?? 0,
        openPunchItems: openPunchItems ?? 0,
        overdueNcrs: overdueNcrs ?? 0,
      },
    };
  };

  const [ownOrgLevelTypes, pendingSignoffs, itpsAwaitingAcceptance, workAwaitingReview, ncrsAssignedToMe, orgHealthResult] =
    await Promise.all([
      loadOwnOrgLevelTypes(),
      loadPendingSignoffs(),
      loadItpsAwaitingAcceptance(),
      loadWorkAwaitingReview(),
      loadNcrsAssignedToMe(),
      loadOrgHealth(),
    ]);
  const { managesOwnOrg, orgHealth } = orgHealthResult;

  // An Admin's own queue item: proposals to the Tier-1 library waiting on their decision (an
  // Inspector can submit one, per lib/itp-master/actions.ts, but only an Admin can approve it).
  // Real fields (title, source ITP, date), the same join pattern as the proposals review page
  // itself — not just a count, so the dashboard panel is actually useful without a click-through.
  interface PendingProposalRow {
    id: string;
    proposed_action: "new_template" | "update_existing";
    proposed_title: string | null;
    created_at: string;
    itps: { id: string; itp_number: string; title: string } | null;
  }
  let pendingProposals: PendingProposalRow[] = [];
  let pendingProposalTotal = 0;
  let orgPortfolio: {
    id: string;
    name: string;
    engagementMode: string;
    activeProjects: number;
    openNcrs: number;
    projects: { id: string; projectNumber: string; name: string; openNcrs: number }[];
  }[] = [];
  let recentActivity: {
    id: string;
    summary: string;
    actorName: string | null;
    projectLabel: string | null;
    createdAt: string;
  }[] = [];
  let openNcrItems: {
    id: string;
    ncrNumber: string;
    severity: "minor_ncr" | "major_ncr";
    createdAt: string;
    projectLabel: string;
    description: string;
    dueDate: string | null;
    status: string;
  }[] = [];
  let openNcrTotal = 0;
  if (isAdminStaff(session)) {
    const [{ data: proposals, count: proposalCount }, { data: activeProjectRows }, { data: openNcrRows }, { data: openNcrListRows }, { data: activityRows }] = await Promise.all([
      supabase
        .from(ITP_MASTER_PROPOSALS_TABLE)
        .select("id, proposed_action, proposed_title, created_at, itps(id, itp_number, title)", { count: "exact" })
        .eq("status", "pending")
        .order("created_at")
        .limit(5)
        .returns<PendingProposalRow[]>(),
      supabase
        .from("projects")
        .select("id, project_number, name, organization_id")
        .eq("status", "active")
        .returns<{ id: string; project_number: string; name: string; organization_id: string }[]>(),
      // All open minor/major NCRs, but ONLY the two ids the per-organisation / per-project counts
      // need — the full rows for the visible list come from the capped query right after.
      supabase
        .from("ncrs")
        .select("id, project_id, projects(organization_id)")
        .neq("status", "closed")
        .neq("severity", "observation")
        .returns<{ id: string; project_id: string; projects: { organization_id: string } | null }[]>(),
      // The 8 most recent, with everything the list and its side panel show.
      supabase
        .from("ncrs")
        .select("id, ncr_number, severity, description, status, due_date, created_at, project_id, projects(project_number, name)")
        .neq("status", "closed")
        .neq("severity", "observation")
        .order("created_at", { ascending: false })
        .limit(8)
        .returns<
          {
            id: string;
            ncr_number: string;
            severity: "minor_ncr" | "major_ncr";
            description: string;
            status: string;
            due_date: string | null;
            created_at: string;
            project_id: string;
            projects: { project_number: string; name: string } | null;
          }[]
        >(),
      // Portfolio-wide "what's been happening" feed (new purpose: less page-hopping, more in one
      // place) — reuses the same audit_log rows every per-project Audit Log page already reads
      // (see app/inspect/projects/[projectId]/audit-log/page.tsx), just unscoped to one project and
      // capped to the most recent handful, so an Admin sees real recent events across every
      // organisation without visiting each project individually.
      supabase
        .from(AUDIT_LOG_TABLE)
        .select("id, summary, created_at, actor:users(full_name), projects(project_number, name)")
        .order("created_at", { ascending: false })
        .limit(8)
        .returns<
          {
            id: string;
            summary: string;
            created_at: string;
            actor: { full_name: string } | null;
            projects: { project_number: string; name: string } | null;
          }[]
        >(),
    ]);
    pendingProposals = proposals ?? [];
    pendingProposalTotal = proposalCount ?? pendingProposals.length;
    openNcrTotal = (openNcrRows ?? []).length;
    // The real list behind the "Open NCRs" KPI tile (new purpose: less page-hopping) — same rows
    // the org-portfolio aggregation below already fetched, just kept in full instead of only
    // counted, so the tile can expand inline to the actual NCRs instead of only a number.
    openNcrItems = (openNcrListRows ?? [])
      .map((row) => ({
        id: row.id,
        ncrNumber: row.ncr_number,
        severity: row.severity,
        createdAt: row.created_at,
        description: row.description,
        dueDate: row.due_date,
        status: row.status,
        projectLabel: row.projects ? `${row.projects.project_number} — ${row.projects.name}` : "—",
      }));
    recentActivity = (activityRows ?? []).map((row) => ({
      id: row.id,
      summary: row.summary,
      actorName: row.actor?.full_name ?? null,
      projectLabel: row.projects ? `${row.projects.project_number} — ${row.projects.name}` : null,
      createdAt: row.created_at,
    }));

    // Per-org portfolio counts: no GROUP BY over PostgREST, so counted client-side from the raw
    // rows above — fine at this scale (a handful of orgs/projects), and still two real, RLS-scoped
    // queries rather than one per organisation.
    const projectsByOrg = new Map<string, { id: string; project_number: string; name: string }[]>();
    for (const row of activeProjectRows ?? []) {
      const list = projectsByOrg.get(row.organization_id) ?? [];
      list.push({ id: row.id, project_number: row.project_number, name: row.name });
      projectsByOrg.set(row.organization_id, list);
    }
    const openNcrsByOrg = new Map<string, number>();
    const openNcrsByProject = new Map<string, number>();
    for (const row of openNcrRows ?? []) {
      openNcrsByProject.set(row.project_id, (openNcrsByProject.get(row.project_id) ?? 0) + 1);
      const orgId = row.projects?.organization_id;
      if (!orgId) continue;
      openNcrsByOrg.set(orgId, (openNcrsByOrg.get(orgId) ?? 0) + 1);
    }
    orgPortfolio = (organizations ?? []).map((org) => {
      const projects = projectsByOrg.get(org.id) ?? [];
      return {
        id: org.id,
        name: org.name,
        engagementMode: org.engagement_mode,
        activeProjects: projects.length,
        openNcrs: openNcrsByOrg.get(org.id) ?? 0,
        // Redesign (less page-hopping, same philosophy as the NCR/Observations/Punch-List
        // workspaces): lets "Your organisations" expand a row inline to its real project list
        // instead of every click navigating to /inspect/projects?org=X.
        projects: projects
          .map((p) => ({ id: p.id, projectNumber: p.project_number, name: p.name, openNcrs: openNcrsByProject.get(p.id) ?? 0 }))
          .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber)),
      };
    });
  }

  // "My pending actions" (matches the prototype's Inspector Dashboard reference) — a real worklist
  // of checklists that either haven't been started yet or have a draft in progress, not just a
  // count. Scoped to Inspector rather than Admin: an Admin's dashboard stays portfolio/strategic
  // (see the proposals panel above), while an Inspector's is the operational one this mirrors.
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
  interface PendingActionRow extends PendingActionItem {
    itpId: string;
    itpNumber: string;
    createdAt: string;
    ageDays: number;
  }
  let pendingActions: PendingActionRow[] = [];
  let overdueHoldPoints = 0;
  let oldestHoldPointDays = 0;

  // Standalone/FAT assignments are real field work items just like checklists, but they live in
  // their own table with their own status machine (draft -> completed, see lib/standalone/actions.ts),
  // so they can't be folded into the checklist query above. Scoped the same way as everything else
  // on this page: no explicit project/user filter, relying on has_project_access RLS (mirrors
  // app/inspect/standalone/page.tsx's own listing query, which is unfiltered beyond an optional
  // project query-param).
  interface PendingStandaloneAssignmentRow {
    id: string;
    assignmentNumber: string;
    assignmentType: AssignmentType;
    equipmentDescription: string;
    status: AssignmentStatus;
    updatedAt: string;
    projectName: string;
  }
  let pendingStandaloneAssignments: PendingStandaloneAssignmentRow[] = [];
  const isInspector = session.isJagsStaff && !isAdminStaff(session);
  if (isInspector) {
    interface TemplateRow {
      id: string;
      itp_item_id: string;
      checklist_number: string;
      created_at: string;
      itp_items: {
        activity: string;
        discipline_id: string | null;
        master_disciplines: { code: string } | null;
        itp_sections: {
          itps: { id: string; itp_number: string; projects: { name: string; organization_id: string } | null } | null;
        } | null;
      } | null;
    }
    // Perf: these three top-level fetches don't depend on each other at all (notifiedRows and
    // standaloneAssignments never touch checklist templates), so run them together instead of one
    // at a time — was previously the first 3 of 8 fully sequential round-trips on this page.
    interface NotifiedRow {
      intervention: string;
      notified_at: string | null;
      itp_items: { itp_sections: { itps: { project_id: string; projects: { organization_id: string } | null } | null } | null } | null;
    }
    interface StandaloneAssignmentRow {
      id: string;
      assignment_number: string;
      assignment_type: AssignmentType;
      equipment_description: string;
      status: AssignmentStatus;
      updated_at: string;
      projects: { name: string } | null;
    }
    const [{ data: templates }, { data: notifiedRows }, { data: standaloneAssignments }] = await Promise.all([
      supabase
        .from(CHECKLIST_TEMPLATES_TABLE)
        .select(
          "id, itp_item_id, checklist_number, created_at, itp_items(activity, discipline_id, master_disciplines(code), itp_sections(itps(id, itp_number, projects(name, organization_id))))"
        )
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<TemplateRow[]>(),
      // "Overdue hold points": a blocking-level row (Hold-equivalent, per each activity's own
      // organisation's intervention_level_types.is_blocking — no longer a hardcoded "H" check) that's
      // been notified but not yet signed off, past its project's notice period (falling back to that
      // organisation's configured default, then the original hardcoded 48h, same three-tier precedence
      // lib/signoff/actions.ts uses to gate everything else Hold-related).
      supabase
        .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
        .select("intervention, notified_at, itp_items(itp_sections(itps(project_id, projects(organization_id))))")
        .eq("status", "notified")
        .returns<NotifiedRow[]>(),
      supabase
        .from(STANDALONE_ASSIGNMENTS)
        .select("id, assignment_number, assignment_type, equipment_description, status, updated_at, projects(name)")
        .neq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(8)
        .returns<StandaloneAssignmentRow[]>(),
    ]);

    // Perf: these two chains share no data dependency (one starts from `templates`, the other from
    // `notifiedRows`, both already fetched above) — run them concurrently as two async closures
    // instead of one long sequential chain. Was previously 4 more sequential round-trips after the
    // first 3; now the whole page's critical path is 3 round-trips deep instead of 8.
    const computePendingActions = async (): Promise<PendingActionRow[]> => {
      const templateIds = (templates ?? []).map((t) => t.id);
      const { data: records } = await supabase
        .from(INSPECTION_RECORDS_TABLE)
        .select("checklist_template_id, overall_result")
        .in("checklist_template_id", templateIds.length > 0 ? templateIds : ["00000000-0000-0000-0000-000000000000"])
        .returns<{ checklist_template_id: string | null; overall_result: string | null }[]>();

      const hasCompleted = new Set((records ?? []).filter((r) => r.overall_result !== null).map((r) => r.checklist_template_id));
      const hasDraft = new Set((records ?? []).filter((r) => r.overall_result === null).map((r) => r.checklist_template_id));

      const pendingTemplates = (templates ?? []).filter((t) => !hasCompleted.has(t.id));

      // Priority isn't a stored field anywhere in the schema — inventing an arbitrary High/Medium/Low
      // would be fabricated data. Instead it's derived, transparently, from the real intervention
      // levels already configured on the activity, resolved through each activity's OWN organisation's
      // configured intervention_level_types (no longer a hardcoded "H"/"W" check): a blocking level
      // anywhere on it makes the activity High priority (work is blocked on it), a non-blocking level
      // that still carries a notice period (the old Witness's defining trait) makes it Medium, anything
      // else (e.g. Review/Surveillance, or a custom level with neither) is Low.
      const itemIds = [...new Set(pendingTemplates.map((t) => t.itp_item_id).filter(Boolean))];
      const itemOrgById = new Map<string, string>();
      for (const t of pendingTemplates) {
        const orgId = t.itp_items?.itp_sections?.itps?.projects?.organization_id;
        if (orgId) itemOrgById.set(t.itp_item_id, orgId);
      }
      const orgIdsForPriority = [...new Set(itemOrgById.values())];

      const [{ data: interventions }, { data: levelTypesForPriority }] = await Promise.all([
        itemIds.length
          ? supabase
              .from("activity_party_intervention")
              .select("itp_item_id, intervention")
              .in("itp_item_id", itemIds)
              .returns<{ itp_item_id: string; intervention: string }[]>()
          : Promise.resolve({ data: [] as { itp_item_id: string; intervention: string }[] }),
        orgIdsForPriority.length
          ? supabase
              .from(INTERVENTION_LEVEL_TYPES_TABLE)
              .select("organization_id, code, is_blocking, default_notice_hours")
              .in("organization_id", orgIdsForPriority)
              .returns<Pick<InterventionLevelTypeRow, "organization_id" | "code" | "is_blocking" | "default_notice_hours">[]>()
          : Promise.resolve({ data: [] as Pick<InterventionLevelTypeRow, "organization_id" | "code" | "is_blocking" | "default_notice_hours">[] }),
      ]);
      const levelTypeByOrgCode = new Map(
        (levelTypesForPriority ?? []).map((l) => [`${l.organization_id}:${l.code}`, l])
      );

      const priorityByItem = new Map<string, "high" | "medium" | "low">();
      for (const row of interventions ?? []) {
        const orgId = itemOrgById.get(row.itp_item_id);
        const levelType = orgId ? levelTypeByOrgCode.get(`${orgId}:${row.intervention}`) : undefined;
        const current = priorityByItem.get(row.itp_item_id);
        if (levelType?.is_blocking) priorityByItem.set(row.itp_item_id, "high");
        else if (levelType?.default_notice_hours != null && current !== "high") priorityByItem.set(row.itp_item_id, "medium");
        else if (!current) priorityByItem.set(row.itp_item_id, "low");
      }

      // Dynamic priority routing: sort by real urgency (a Hold-gated activity outranks a Witness one,
      // which outranks a plain Review/Surveillance one — see priorityByItem above) before truncating to
      // 8, so what actually surfaces here is the most urgent work, not just whatever was created most
      // recently. Ties within a priority tier go to whichever's been pending longest.
      return sortByDynamicPriority(
        pendingTemplates.map((t) => {
          const itp = t.itp_items?.itp_sections?.itps;
          const ageDays = Math.floor((today.getTime() - new Date(t.created_at).getTime()) / 86_400_000);
          return {
            templateId: t.id,
            checklistNumber: t.checklist_number,
            activity: t.itp_items?.activity ?? "Untitled activity",
            discipline: t.itp_items?.master_disciplines?.code ?? null,
            priority: priorityByItem.get(t.itp_item_id) ?? "low",
            itpId: itp?.id ?? "",
            itpNumber: itp?.itp_number ?? "",
            projectName: itp?.projects?.name ?? "",
            status: (hasDraft.has(t.id) ? "in_progress" : "not_started") as "in_progress" | "not_started",
            createdAt: t.created_at,
            ageDays,
          };
        })
      ).slice(0, 8);
    };

    // "Overdue hold points": a blocking-level row (Hold-equivalent, per each activity's own
    // organisation's intervention_level_types.is_blocking — no longer a hardcoded "H" check) that's
    // been notified but not yet signed off, past its project's notice period (falling back to that
    // organisation's configured default, then the original hardcoded 48h, same three-tier precedence
    // lib/signoff/actions.ts uses to gate everything else Hold-related).
    const computeOverdueHoldPoints = async (): Promise<{ overdueHoldPoints: number; oldestHoldPointDays: number }> => {
      const orgIdsForOverdue = [
        ...new Set(
          (notifiedRows ?? [])
            .map((r) => r.itp_items?.itp_sections?.itps?.projects?.organization_id)
            .filter((id): id is string => !!id)
        ),
      ];
      const { data: levelTypesForOverdue } = orgIdsForOverdue.length
        ? await supabase
            .from(INTERVENTION_LEVEL_TYPES_TABLE)
            .select("organization_id, code, is_blocking, default_notice_hours")
            .in("organization_id", orgIdsForOverdue)
            .eq("is_blocking", true)
            .returns<Pick<InterventionLevelTypeRow, "organization_id" | "code" | "is_blocking" | "default_notice_hours">[]>()
        : { data: [] as Pick<InterventionLevelTypeRow, "organization_id" | "code" | "is_blocking" | "default_notice_hours">[] };
      const blockingLevelByOrgCode = new Map(
        (levelTypesForOverdue ?? []).map((l) => [`${l.organization_id}:${l.code}`, l])
      );

      const notifiedHolds = (notifiedRows ?? []).filter((row) => {
        const orgId = row.itp_items?.itp_sections?.itps?.projects?.organization_id;
        return orgId && blockingLevelByOrgCode.has(`${orgId}:${row.intervention}`);
      });

      const projectIds = [
        ...new Set((notifiedHolds ?? []).map((r) => r.itp_items?.itp_sections?.itps?.project_id).filter((id): id is string => !!id)),
      ];
      const { data: noticeConfigs } = projectIds.length
        ? await supabase
            .from(NOTICE_PERIOD_CONFIGS_TABLE)
            .select("project_id, intervention, hours")
            .in("intervention", ["H", ...[...blockingLevelByOrgCode.values()].map((l) => l.code)])
            .in("project_id", projectIds)
            .returns<{ project_id: string; intervention: string; hours: number }[]>()
        : { data: [] as { project_id: string; intervention: string; hours: number }[] };
      const hoursByProjectIntervention = new Map((noticeConfigs ?? []).map((c) => [`${c.project_id}:${c.intervention}`, c.hours]));

      const overdueAgeDays: number[] = [];
      for (const row of notifiedHolds ?? []) {
        if (!row.notified_at) continue;
        const projectId = row.itp_items?.itp_sections?.itps?.project_id;
        const orgId = row.itp_items?.itp_sections?.itps?.projects?.organization_id;
        const levelType = orgId ? blockingLevelByOrgCode.get(`${orgId}:${row.intervention}`) : undefined;
        const noticeHours =
          (projectId ? hoursByProjectIntervention.get(`${projectId}:${row.intervention}`) : undefined) ??
          levelType?.default_notice_hours ??
          DEFAULT_NOTICE_PERIOD_HOURS[row.intervention] ??
          48;
        const ageMs = today.getTime() - new Date(row.notified_at).getTime();
        if (ageMs > noticeHours * 60 * 60 * 1000) overdueAgeDays.push(Math.floor(ageMs / 86_400_000));
      }
      return {
        overdueHoldPoints: overdueAgeDays.length,
        oldestHoldPointDays: overdueAgeDays.length > 0 ? Math.max(...overdueAgeDays) : 0,
      };
    };

    const [computedPendingActions, overdueResult] = await Promise.all([
      computePendingActions(),
      computeOverdueHoldPoints(),
    ]);
    pendingActions = computedPendingActions;
    overdueHoldPoints = overdueResult.overdueHoldPoints;
    oldestHoldPointDays = overdueResult.oldestHoldPointDays;

    // standaloneAssignments was already fetched in the top-level Promise.all above.
    pendingStandaloneAssignments = (standaloneAssignments ?? []).map((a) => ({
      id: a.id,
      assignmentNumber: a.assignment_number,
      assignmentType: a.assignment_type,
      equipmentDescription: a.equipment_description,
      status: a.status,
      updatedAt: a.updated_at,
      projectName: a.projects?.name ?? "",
    }));
  }

  const pendingToday = pendingActions.filter((a) => isSameDay(a.createdAt));
  const pendingOverdue = pendingActions.filter((a) => a.ageDays >= OVERDUE_DAYS);

  // ncrsAssignedToMe / managesOwnOrg / orgHealth are loaded concurrently with the other external-
  // party queries near the top of this function (see the Promise.all there) — nothing left to
  // await for them here.

  if (!session.isJagsStaff) {
    const toSignoffQueueRow = (row: PendingSignoffRow): SignoffQueueRow => {
      const itp = row.itp_items?.itp_sections?.itps;
      return {
        id: row.id,
        intervention: row.intervention,
        status: row.status,
        activity: row.itp_items?.activity ?? "Untitled activity",
        itpId: itp?.id ?? "",
        itpNumber: itp?.itp_number ?? "",
        itpTitle: itp?.title ?? "",
        when: timeAgo(row.notified_at),
      };
    };

    return (
      <ExternalPartyDashboard
        // The grant role is the login's real role; the first linked party row is only a fallback
        // (a login linked to several parties used to show whichever happened to sort first — a
        // client login rendered as "Subcontractor" with another company's name).
        orgName={
          isClientRole
            ? ((organizations ?? []).find((o) => o.id === ownOrgId)?.name ?? ownParties?.[0]?.name ?? null)
            : ownParties && ownParties.length > 0
              ? ownParties[0].name
              : null
        }
        roleKey={
          isClientRole
            ? "client"
            : isMainContractorRole
              ? "main_contractor"
              : ownParties && ownParties.length > 0
                ? ownParties[0].party_type
                : null
        }
        today={today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        activeProjects={activeProjects ?? 0}
        activeItps={activeItps ?? 0}
        pendingInspections={pendingInspections ?? 0}
        openNcrs={openNcrs ?? 0}
        myProjects={myProjects}
        itpsAwaitingAcceptance={itpsAwaitingAcceptance.map((itp) => ({
          id: itp.id,
          itpNumber: itp.itp_number,
          title: itp.title,
          projectName: itp.projects?.name ?? "",
        }))}
        workAwaitingReview={workAwaitingReview.map(toSignoffQueueRow)}
        pendingSignoffs={pendingSignoffs.map(toSignoffQueueRow)}
        levels={ownOrgLevelTypes ?? []}
        managesOwnOrg={managesOwnOrg}
        orgHealth={orgHealth}
        ncrsAssignedToMe={ncrsAssignedToMe.map((n) => ({
          id: n.id,
          ncrNumber: n.ncr_number,
          severity: n.severity,
          description: n.description,
          dueDate: n.due_date,
          projectName: n.projects?.name ?? "",
        }))}
      />
    );
  }

  if (isInspector) {
    return (
      <InspectorDashboard
        firstName={session.fullName.split(" ")[0] ?? session.fullName}
        today={today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        activeProjects={activeProjects ?? 0}
        activeItps={activeItps ?? 0}
        pendingInspections={pendingInspections ?? 0}
        overdueHoldPoints={overdueHoldPoints}
        oldestHoldPointDays={oldestHoldPointDays}
        pendingActions={pendingActions}
        pendingToday={pendingToday}
        pendingOverdue={pendingOverdue}
        pendingStandaloneAssignments={pendingStandaloneAssignments}
      />
    );
  }

  const adminTodayItems = buildAdminToday({
    ncrs: openNcrItems.map((n) => ({
      id: n.id,
      ncrNumber: n.ncrNumber,
      severity: n.severity,
      description: n.description,
      projectLabel: n.projectLabel,
      dueDate: n.dueDate,
    })),
    proposals: pendingProposals.map((p) => ({
      id: p.id,
      title:
        p.proposed_action === "new_template"
          ? `New template: ${p.proposed_title || p.itps?.title || "Untitled"}`
          : "Update existing template",
    })),
  });
  const adminTodayDescription =
    "Overdue hold points, NCRs and library proposals waiting on you. Click a row to act on it here, without leaving the dashboard.";

  // Only JAGS Admin reaches this point — external parties and Inspectors both returned their own
  // dedicated dashboard component above.
  return (
    <AdminDashboard
      firstName={session.fullName.split(" ")[0] ?? session.fullName}
      today={today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      activeProjects={activeProjects ?? 0}
      activeItps={activeItps ?? 0}
      pendingInspections={pendingInspections ?? 0}
      openNcrTotal={openNcrTotal}
      pendingProposalTotal={pendingProposalTotal}
      pendingProposals={pendingProposals.map((p) => ({
        id: p.id,
        title:
          p.proposed_action === "new_template"
            ? `New template: ${p.proposed_title || p.itps?.title || "Untitled"}`
            : `Update existing template`,
        sourceItpId: p.itps?.id ?? null,
        sourceItpLabel: p.itps ? `${p.itps.itp_number} — ${p.itps.title}` : null,
        submittedOn: p.created_at,
      }))}
      orgPortfolio={orgPortfolio}
      recentActivity={recentActivity}
      openNcrItems={openNcrItems}
      // Streamed: the slowest dashboard query no longer blocks every other tile and list.
      todayQueue={
        // Shows NCRs and proposals immediately; the overdue hold points (the slow query) stream in.
        <Suspense fallback={<TodayQueue description={adminTodayDescription} items={adminTodayItems} />}>
          <AdminTodayWithHolds baseItems={adminTodayItems} description={adminTodayDescription} />
        </Suspense>
      }
      overdueHoldsTile={
        <Suspense fallback={<StatCard label="Overdue hold points" value="…" />}>
          <OverdueHoldsTile />
        </Suspense>
      }
      overdueHoldsCard={
        <Suspense fallback={<WatchlistSkeleton title="Overdue hold points" />}>
          <OverdueHoldsCard />
        </Suspense>
      }
    />
  );
}
