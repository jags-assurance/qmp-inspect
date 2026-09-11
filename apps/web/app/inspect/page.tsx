import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ACTIVITY_SIGNOFF_PROGRESS_TABLE,
  DEFAULT_NOTICE_PERIOD_HOURS,
  NOTICE_PERIOD_CONFIGS_TABLE,
  type ActivitySignoffProgressRow,
} from "@/lib/signoff/db-types";
import { ITP_MASTER_PROPOSALS_TABLE } from "@/lib/itp-master/types";
import { CHECKLIST_TEMPLATES_TABLE, INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import type { PendingActionItem } from "@/components/domain/pending-actions-table";
import { ExternalPartyDashboard, type SignoffQueueRow } from "./external-party-dashboard";
import { InspectorDashboard } from "./inspector-dashboard";
import { AdminDashboard } from "./admin-dashboard";

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
    .select("id, name, party_type")
    .eq("user_id", session.userId)
    .returns<{ id: string; name: string; party_type: string }[]>();

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
  let itpsAwaitingAcceptance: { id: string; itp_number: string; title: string; projects: { name: string } | null }[] = [];
  if (isClientRole) {
    const { data } = await supabase
      .from("itps")
      .select("id, itp_number, title, projects(name)")
      .eq("status", "approved")
      .limit(5)
      .returns<{ id: string; itp_number: string; title: string; projects: { name: string } | null }[]>();
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
  let orgPortfolio: { id: string; name: string; engagementMode: string; activeProjects: number; openNcrs: number }[] = [];
  if (isAdminStaff(session)) {
    const [{ data: proposals }, { data: activeProjectRows }, { data: openNcrRows }] = await Promise.all([
      supabase
        .from(ITP_MASTER_PROPOSALS_TABLE)
        .select("id, proposed_action, proposed_title, created_at, itps(id, itp_number, title)")
        .eq("status", "pending")
        .order("created_at")
        .limit(5)
        .returns<PendingProposalRow[]>(),
      supabase.from("projects").select("organization_id").eq("status", "active").returns<{ organization_id: string }[]>(),
      supabase
        .from("ncrs")
        .select("projects(organization_id)")
        .neq("status", "closed")
        .returns<{ projects: { organization_id: string } | null }[]>(),
    ]);
    pendingProposals = proposals ?? [];

    // Per-org portfolio counts: no GROUP BY over PostgREST, so counted client-side from the raw
    // rows above — fine at this scale (a handful of orgs/projects), and still two real, RLS-scoped
    // queries rather than one per organisation.
    const activeProjectsByOrg = new Map<string, number>();
    for (const row of activeProjectRows ?? []) {
      activeProjectsByOrg.set(row.organization_id, (activeProjectsByOrg.get(row.organization_id) ?? 0) + 1);
    }
    const openNcrsByOrg = new Map<string, number>();
    for (const row of openNcrRows ?? []) {
      const orgId = row.projects?.organization_id;
      if (!orgId) continue;
      openNcrsByOrg.set(orgId, (openNcrsByOrg.get(orgId) ?? 0) + 1);
    }
    orgPortfolio = (organizations ?? []).map((org) => ({
      id: org.id,
      name: org.name,
      engagementMode: org.engagement_mode,
      activeProjects: activeProjectsByOrg.get(org.id) ?? 0,
      openNcrs: openNcrsByOrg.get(org.id) ?? 0,
    }));
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
          itps: { id: string; itp_number: string; projects: { name: string } | null } | null;
        } | null;
      } | null;
    }
    const { data: templates } = await supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select(
        "id, itp_item_id, checklist_number, created_at, itp_items(activity, discipline_id, master_disciplines(code), itp_sections(itps(id, itp_number, projects(name))))"
      )
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

    const pendingTemplates = (templates ?? []).filter((t) => !hasCompleted.has(t.id));

    // Priority isn't a stored field anywhere in the schema — inventing an arbitrary High/Medium/Low
    // would be fabricated data. Instead it's derived, transparently, from the real intervention
    // levels already configured on the activity: a Hold anywhere on it makes the activity High
    // priority (work is blocked on it), a Witness makes it Medium, anything else is Low.
    const itemIds = [...new Set(pendingTemplates.map((t) => t.itp_item_id).filter(Boolean))];
    const { data: interventions } = itemIds.length
      ? await supabase
          .from("activity_party_intervention")
          .select("itp_item_id, intervention")
          .in("itp_item_id", itemIds)
          .returns<{ itp_item_id: string; intervention: "H" | "W" | "R" | "S" }[]>()
      : { data: [] as { itp_item_id: string; intervention: "H" | "W" | "R" | "S" }[] };

    const priorityByItem = new Map<string, "high" | "medium" | "low">();
    for (const row of interventions ?? []) {
      const current = priorityByItem.get(row.itp_item_id);
      if (row.intervention === "H") priorityByItem.set(row.itp_item_id, "high");
      else if (row.intervention === "W" && current !== "high") priorityByItem.set(row.itp_item_id, "medium");
      else if (!current) priorityByItem.set(row.itp_item_id, "low");
    }

    pendingActions = pendingTemplates
      .map((t) => {
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
      .slice(0, 8);

    // "Overdue hold points": a Hold that's been notified but not yet signed off, past its project's
    // notice period (default 48h, same threshold lib/signoff/actions.ts uses to gate everything
    // else Hold-related) — a real, already-established definition, not a new invented one.
    const { data: notifiedHolds } = await supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select("notified_at, itp_items(itp_sections(itps(project_id)))")
      .eq("intervention", "H")
      .eq("status", "notified")
      .returns<{ notified_at: string | null; itp_items: { itp_sections: { itps: { project_id: string } | null } | null } | null }[]>();

    const projectIds = [
      ...new Set((notifiedHolds ?? []).map((r) => r.itp_items?.itp_sections?.itps?.project_id).filter((id): id is string => !!id)),
    ];
    const { data: noticeConfigs } = projectIds.length
      ? await supabase
          .from(NOTICE_PERIOD_CONFIGS_TABLE)
          .select("project_id, hours")
          .eq("intervention", "H")
          .in("project_id", projectIds)
          .returns<{ project_id: string; hours: number }[]>()
      : { data: [] as { project_id: string; hours: number }[] };
    const hoursByProject = new Map((noticeConfigs ?? []).map((c) => [c.project_id, c.hours]));

    const overdueAgeDays: number[] = [];
    for (const row of notifiedHolds ?? []) {
      if (!row.notified_at) continue;
      const projectId = row.itp_items?.itp_sections?.itps?.project_id;
      const noticeHours = (projectId ? hoursByProject.get(projectId) : undefined) ?? DEFAULT_NOTICE_PERIOD_HOURS.H;
      const ageMs = today.getTime() - new Date(row.notified_at).getTime();
      if (ageMs > noticeHours * 60 * 60 * 1000) overdueAgeDays.push(Math.floor(ageMs / 86_400_000));
    }
    overdueHoldPoints = overdueAgeDays.length;
    oldestHoldPointDays = overdueAgeDays.length > 0 ? Math.max(...overdueAgeDays) : 0;
  }

  const pendingToday = pendingActions.filter((a) => isSameDay(a.createdAt));
  const pendingOverdue = pendingActions.filter((a) => a.ageDays >= OVERDUE_DAYS);

  if (!session.isJagsStaff) {
    const toSignoffQueueRow = (row: PendingSignoffRow): SignoffQueueRow => {
      const itp = row.itp_items?.itp_sections?.itps;
      return {
        id: row.id,
        intervention: row.intervention,
        activity: row.itp_items?.activity ?? "Untitled activity",
        itpId: itp?.id ?? "",
        itpNumber: itp?.itp_number ?? "",
        itpTitle: itp?.title ?? "",
        when: timeAgo(row.notified_at),
      };
    };

    return (
      <ExternalPartyDashboard
        orgName={ownParties && ownParties.length > 0 ? ownParties[0].name : null}
        roleKey={ownParties && ownParties.length > 0 ? ownParties[0].party_type : null}
        today={today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        activeProjects={activeProjects ?? 0}
        activeItps={activeItps ?? 0}
        pendingInspections={pendingInspections ?? 0}
        openNcrs={openNcrs ?? 0}
        itpsAwaitingAcceptance={itpsAwaitingAcceptance.map((itp) => ({
          id: itp.id,
          itpNumber: itp.itp_number,
          title: itp.title,
          projectName: itp.projects?.name ?? "",
        }))}
        workAwaitingReview={workAwaitingReview.map(toSignoffQueueRow)}
        pendingSignoffs={pendingSignoffs.map(toSignoffQueueRow)}
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
      />
    );
  }

  // Only JAGS Admin reaches this point — external parties and Inspectors both returned their own
  // dedicated dashboard component above.
  return (
    <AdminDashboard
      firstName={session.fullName.split(" ")[0] ?? session.fullName}
      today={today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      activeProjects={activeProjects ?? 0}
      activeItps={activeItps ?? 0}
      pendingInspections={pendingInspections ?? 0}
      openNcrs={openNcrs ?? 0}
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
    />
  );
}
