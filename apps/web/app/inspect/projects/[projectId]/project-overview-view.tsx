import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { OrgBrandScope } from "@/components/domain/org-brand-scope";
import { AddProjectPartyForm } from "./add-project-party-form";
import { AddSelfManagedPartyForm } from "./add-self-managed-party-form";
import { ReassignPartyForm } from "./reassign-party-form";
import { ProvisionPartyLoginForm } from "./provision-party-login-form";
import { PartyMembersPanel, type PartyMemberRow, type CustomRoleOption } from "./party-members-panel";
import { PROJECT_PARTY_MEMBERS_TABLE } from "@/lib/projects/party-access-types";
import { AllowClientExecutionToggle } from "./allow-client-execution-toggle";
import { AllowClientItpCreationToggle } from "./allow-client-itp-creation-toggle";
import { AllowContractorItpCreationToggle } from "./allow-contractor-itp-creation-toggle";
import { AllowContractorStandaloneAssignmentToggle } from "./allow-contractor-standalone-assignment-toggle";
import { EnforceHoldBlocksStartToggle } from "./enforce-hold-blocks-start-toggle";
import { isTeamLeadForProject } from "@/lib/teams/helpers";
import { isClientTeamLeadForProject } from "@/lib/client-teams/helpers";
import { ProjectPartyActiveToggle } from "./project-party-active-toggle";
import { DeactivateAllPartiesControl } from "./deactivate-all-parties-control";
import { ResponsiblePersonPicker } from "./responsible-person-picker";
import { isAiConfigured } from "@/lib/ai/gate";
import { hasPermission } from "@/lib/rbac/permissions";
import { AskProjectPanel } from "./ask-project-panel";
import { ReviewChainForm } from "./review-chain-form";
import { getProjectReviewChain } from "@/lib/itps/review-chain";
import { PageGuide } from "@/components/domain/page-guide";
import { ProjectStatusControl } from "./project-status-control";
import { NoticePeriodSettings } from "./notice-period-settings";
import { INTERVENTION_LEVEL_TYPES_TABLE, sortLevels, type InterventionLevelTypeRow } from "@/lib/intervention-levels/types";
import { NOTICE_PERIOD_CONFIGS_TABLE, type NoticePeriodConfigRow } from "@/lib/signoff/db-types";
import { LocationPresetsSettings } from "./location-presets-settings";
import { getLocationPresetsForProject } from "@/lib/checklists/location-presets";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  on_hold: "warning",
  completed: "neutral",
  cancelled: "danger",
};

const PARTY_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  main_contractor: "Main Contractor",
  subcontractor: "Subcontractor",
  tpi_lab: "TPI / Lab",
  vendor: "Vendor",
  jags: "JAGS Assurance",
};

interface ProjectDetail {
  id: string;
  project_number: string;
  name: string;
  site_location: string | null;
  country: string | null;
  contract_number: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  organization_id: string;
  allow_client_execution: boolean;
  allow_client_itp_creation: boolean;
  allow_contractor_itp_creation: boolean;
  allow_contractor_standalone_assignment: boolean;
  enforce_hold_blocks_start: boolean;
  responsible_person_id: string | null;
  responsible_person: { full_name: string; email: string } | null;
  organizations: {
    name: string;
    engagement_mode: string;
    engagement_scope: string;
    brand_primary_color: string | null;
    brand_accent_color: string | null;
  } | null;
}

/**
 * A project's status can be flipped to completed/cancelled by mistake or only briefly — so the bulk
 * "deactivate all project access" action is gated on this, not fired automatically by the status
 * change itself. See lib/projects/actions.ts (deactivateAllProjectPartiesAction) for the full
 * rationale.
 */
const STATUSES_ELIGIBLE_FOR_BULK_DEACTIVATE = new Set(["completed", "cancelled"]);

/**
 * The project-detail hub this app was missing: before this, registers/data-book/kpis/punch-list
 * were real, fully-built pages with no navigable entry point anywhere — only reachable by typing
 * the URL directly (see docs/MANUAL_TESTING_GUIDE.md, which does exactly that). This page is that
 * entry point, plus real per-project numbers computed here rather than guessed at.
 */
export async function ProjectOverviewView({ projectId, tabBar }: { projectId: string; tabBar: ReactNode }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, project_number, name, site_location, country, contract_number, start_date, end_date, status, organization_id, allow_client_execution, allow_client_itp_creation, allow_contractor_itp_creation, allow_contractor_standalone_assignment, enforce_hold_blocks_start, responsible_person_id, responsible_person:users!projects_responsible_person_id_fkey(full_name, email), organizations(name, engagement_mode, engagement_scope, brand_primary_color, brand_accent_color)"
    )
    .eq("id", projectId)
    .maybeSingle<ProjectDetail>();

  if (!project) notFound();

  const [
    { data: parties },
    { count: itpCount },
    { count: openNcrCount },
    { count: pendingInspectionCount },
    { count: openPunchCount },
    { data: assignedClientTeams },
  ] = await Promise.all([
    supabase
      .from("project_parties")
      .select("id, name, party_type, is_active, onboarded_by, user_id, contact_email, access_mode, users(full_name, email)")
      .eq("project_id", projectId)
      .order("is_active", { ascending: false })
      .order("party_type")
      .returns<
        {
          id: string;
          name: string;
          party_type: string;
          is_active: boolean;
          onboarded_by: "jags" | "client";
          user_id: string | null;
          contact_email: string | null;
          access_mode: "whole_org" | "selected_people";
          users: { full_name: string; email: string } | null;
        }[]
      >(),
    supabase.from("itps").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("ncrs").select("id", { count: "exact", head: true }).eq("project_id", projectId).neq("status", "closed"),
    supabase
      .from("inspection_records")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("overall_result", null),
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "open"),
    // Read-only visibility for client_team_project_assignments (organisation/client-teams' "Assign
    // to project" control) — previously that assignment had no consequence anywhere outside the
    // admin page that wrote it; showing it here at least makes the assignment itself legible from
    // the project a team is actually responsible for, alongside the real permission effect wired
    // into canReassign/isClientTeamLead below.
    supabase
      .from("client_team_project_assignments")
      .select("client_teams(name)")
      .eq("project_id", projectId)
      .returns<{ client_teams: { name: string } | null }[]>(),
  ]);

  // Reassignment is a sensitive affordance — gated the same way reassignSignoffPartyAction gates
  // itself server-side: a JAGS Admin, or a lead of a JAGS team actually assigned to this project.
  // Computed once here so both the party list and the eligible-user fetch below use the identical
  // check the server action re-verifies.
  const canReassign = isAdminStaff(session) || (await isTeamLeadForProject(supabase, session.userId, project.id));

  // A client team's own lead reaches the same reassign capability too, but only for that project's
  // own party_type='client' rows (project_parties_u RLS, 20260929020000_client_team_project_parties_
  // reassign.sql, is the real enforcement — this mirrors it to decide whether the affordance shows
  // up at all). This is what gives "Assign [client team] to project" (organisation/client-teams) a
  // real effect, rather than the row it writes being read by nothing.
  const isClientTeamLead = await isClientTeamLeadForProject(supabase, session.userId, project.id);

  // Self-managed client party onboarding (supabase/migrations/20260919020000_self_managed_project_party_access.sql):
  // shown instead of the JAGS-only AddProjectPartyForm below, to a non-staff user whose access
  // already reaches this project (implied by having loaded this page at all — project_parties_select
  // requires has_org_access) on an org that's opted into engagement_scope = 'self_managed' OR
  // 'client_managed' (client_managed is a superset capability tier — it can do everything
  // self_managed can, plus approve/provision on its own). JAGS staff keep using the admin form
  // regardless of the org's scope.
  const canAddSelfManagedParty =
    !session.isJagsStaff &&
    (project.organizations?.engagement_scope === "self_managed" || project.organizations?.engagement_scope === "client_managed");

  // "Full Client-Managed" tier's whole point: this org's own people can provision brand-new logins
  // for their own team without a JAGS Admin, via the provision_party_login custom-role grant (see
  // CLIENT_MANAGED_ONLY_PERMISSION_KEYS) — never available on a plain self_managed org.
  const canProvisionPartyLogin = isAdminStaff(session) || (await hasPermission(session.userId, "provision_party_login", project.id));

  // Party-members/custom-permission management (project_party_members,
  // 20260930180000_project_party_members.sql) — gated identically to canProvisionPartyLogin since
  // it's the same sensitivity level (granting/revoking real project access), and only fetched at all
  // when at least one party exists to attach the panel to.
  let partyMembersByPartyId = new Map<string, PartyMemberRow[]>();
  let orgCustomRoles: CustomRoleOption[] = [];
  if (canProvisionPartyLogin && (parties ?? []).length > 0) {
    const [{ data: memberRows }, { data: roleRows }] = await Promise.all([
      supabase
        .from(PROJECT_PARTY_MEMBERS_TABLE)
        .select("id, project_party_id, user_id, invited_email, permission_mode, custom_role_id, users(full_name, email), custom_roles(name)")
        .in("project_party_id", (parties ?? []).map((p) => p.id))
        .returns<(PartyMemberRow & { project_party_id: string })[]>(),
      supabase
        .from("custom_roles")
        .select("id, name, organization_id")
        .or(`organization_id.eq.${project.organization_id},organization_id.is.null`)
        .order("name")
        .returns<{ id: string; name: string; organization_id: string | null }[]>(),
    ]);
    for (const row of memberRows ?? []) {
      const list = partyMembersByPartyId.get(row.project_party_id) ?? [];
      list.push(row);
      partyMembersByPartyId.set(row.project_party_id, list);
    }
    orgCustomRoles = (roleRows ?? []).map((r) => ({ id: r.id, name: r.name }));
  }

  const projectLocationPresets = (
    isAdminStaff(session) || canAddSelfManagedParty
      ? (await getLocationPresetsForProject(supabase, project.organization_id, project.id)).filter((r) => r.project_id === project.id)
      : []
  ).map((r) => ({ id: r.id, name: r.name }));

  let staffUsers: { id: string; full_name: string }[] = [];
  let reviewChain: { reviewerUserId: string }[] = [];
  let interventionLevels: InterventionLevelTypeRow[] = [];
  let noticePeriodConfigs: Record<string, number> = {};
  if (isAdminStaff(session)) {
    const [{ data: staffData }, chainData, { data: levelData }, { data: noticeData }] = await Promise.all([
      supabase.from("users").select("id, full_name").eq("is_jags_staff", true).order("full_name").returns<{ id: string; full_name: string }[]>(),
      getProjectReviewChain(supabase, project.id),
      supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("id, organization_id, code, label, sort_order, is_blocking, default_notice_hours, created_at")
        .eq("organization_id", project.organization_id)
        .returns<InterventionLevelTypeRow[]>(),
      supabase
        .from(NOTICE_PERIOD_CONFIGS_TABLE)
        .select("intervention, hours")
        .eq("project_id", project.id)
        .returns<Pick<NoticePeriodConfigRow, "intervention" | "hours">[]>(),
    ]);
    staffUsers = staffData ?? [];
    reviewChain = chainData;
    interventionLevels = sortLevels(levelData ?? []);
    noticePeriodConfigs = Object.fromEntries((noticeData ?? []).map((r) => [r.intervention, r.hours]));
  }

  // Eligible reassignment targets: anyone whose access already reaches this project's organisation
  // (global/organisation/project-scoped access_grants) or this project specifically — a broader set
  // than only existing party-linked users, since reassignment is precisely for handing a party's
  // sign-off responsibility to someone who doesn't hold it yet.
  let eligibleUsers: { id: string; full_name: string; email: string }[] = [];
  if (canReassign || isClientTeamLead) {
    const { data: grantedUserIds } = await supabase
      .from("access_grants")
      .select("user_id")
      .or(`scope_type.eq.global,organization_id.eq.${project.organization_id},project_id.eq.${project.id}`);
    const userIds = Array.from(new Set((grantedUserIds ?? []).map((g) => g.user_id)));
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, email")
        .in("id", userIds)
        .order("full_name");
      eligibleUsers = users ?? [];
    }
  }

  return (
    <OrgBrandScope
      colors={{
        brand_primary_color: project.organizations?.brand_primary_color ?? null,
        brand_accent_color: project.organizations?.brand_accent_color ?? null,
      }}
    >
    <div>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="doc-id text-sm text-muted">{project.project_number}</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">{project.name}</h1>
            <PageGuide
              title="Project hub — how this works"
              points={[
                "The entry point into everything scoped to this project — ITPs, NCRs, registers, punch list, data book, reports, and every party engaged on it.",
                "Adding parties is normally Admin-only; on a Self-Managed (Hybrid) or Full Client-Managed organisation's project, that org's own non-staff users get a second, separate form to add their own parties.",
                "Provisioning a login for a party (turning \"No linked login yet\" into an active user) is available to an Admin, or to anyone holding the provision_party_login permission on this project — the way a Full Client-Managed org's own people onboard their own team without JAGS.",
                "\"Responsible Person\", checklist execution, ITP creation toggles and hold-point enforcement settings are Admin-only — each one applies to THIS project only, never platform-wide.",
                "Reassigning a party's sign-off responsibility is available to an Admin, a lead of a JAGS team assigned to this project, or (for that project's own client-type party) a client team lead.",
                "Audit Log only appears here for JAGS staff — it's an internal governance view, not something a client or contractor party sees.",
                "The status dropdown next to the project name (Admin-only) is the only place that changes a project's status — nothing else in the app sets it automatically, including compiling the Data Book or acknowledging Handover.",
                "\"Deactivate all parties\" only unlocks once the project's status is completed or cancelled, so it can't be fired by mistake on a live project — and even then it's its own separate click, never automatic on the status change itself.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {project.organizations?.name ?? "—"}
            {project.site_location && ` · ${project.site_location}`}
            {project.country && `, ${project.country}`}
          </p>
        </div>
        {isAdminStaff(session) ? (
          <ProjectStatusControl projectId={project.id} status={project.status} />
        ) : (
          <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>{project.status.replace("_", " ")}</Badge>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-off-white px-3 py-2">
        <span className="text-sm font-medium text-ink">Responsible Person:</span>
        {project.responsible_person ? (
          <span className="text-sm text-ink">
            {project.responsible_person.full_name}{" "}
            <span className="text-muted">({project.responsible_person.email})</span>
          </span>
        ) : (
          <span className="text-sm text-muted">Not set</span>
        )}
      </div>
      {isAdminStaff(session) && (
        <ResponsiblePersonPicker
          projectId={project.id}
          currentResponsiblePersonId={project.responsible_person_id}
          eligibleUsers={eligibleUsers}
        />
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ITPs" value={itpCount ?? 0} />
        <StatCard label="Pending inspections" value={pendingInspectionCount ?? 0} />
        <StatCard label="Open NCRs" value={openNcrCount ?? 0} />
        <StatCard label="Open punch items" value={openPunchCount ?? 0} />
      </div>

      {/* The workspace tab bar (see page.tsx) — replaces the two grids of section cards that used to
          send people off to a different page for every section of the project. */}
      {tabBar}

      {isAiConfigured() && <AskProjectPanel projectId={project.id} />}

      <div className="mt-8 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium text-ink">Project parties</h2>
            <p className="mt-1 text-sm text-muted">Every organisation engaged on this project.</p>
            {(assignedClientTeams ?? []).length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                Client team{assignedClientTeams!.length > 1 ? "s" : ""} assigned:
                {(assignedClientTeams ?? []).map((a, i) => (
                  <Badge key={i} tone="info">
                    {a.client_teams?.name ?? "Unknown team"}
                  </Badge>
                ))}
              </p>
            )}
          </div>
          {isAdminStaff(session) && STATUSES_ELIGIBLE_FOR_BULK_DEACTIVATE.has(project.status) && (
            <DeactivateAllPartiesControl
              projectId={project.id}
              hasActiveParties={(parties ?? []).some((p) => p.is_active)}
            />
          )}
        </div>
        <ul className="mt-4 space-y-2">
          {(parties ?? []).map((party) => (
            <li
              key={party.id}
              className={`rounded-md border px-3 py-2 text-sm ${
                party.is_active ? "border-border" : "border-border bg-off-white opacity-70"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-ink">
                  {party.name}
                  {!party.is_active && <span className="ml-2 text-xs text-muted">(inactive)</span>}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={party.onboarded_by === "client" ? "info" : "neutral"}>
                    {party.onboarded_by === "client" ? "Client-onboarded" : "JAGS-onboarded"}
                  </Badge>
                  <span className="text-muted">{PARTY_TYPE_LABEL[party.party_type] ?? party.party_type}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>{party.users ? `${party.users.full_name} (${party.users.email})` : "No linked login yet"}</span>
                <span className="flex items-center gap-2">
                  {canProvisionPartyLogin && !party.user_id && party.is_active && (
                    <ProvisionPartyLoginForm projectPartyId={party.id} contactEmail={party.contact_email} />
                  )}
                  {(canReassign || (isClientTeamLead && party.party_type === "client")) && party.is_active && (
                    <ReassignPartyForm projectPartyId={party.id} eligibleUsers={eligibleUsers} />
                  )}
                  {isAdminStaff(session) && (
                    <ProjectPartyActiveToggle
                      // Force a remount whenever is_active flips: useActionState binds its action
                      // function once at mount, so without a key that changes here the toggle would
                      // keep calling whichever of deactivate/reactivate it was first mounted with.
                      key={party.is_active ? "active" : "inactive"}
                      projectId={project.id}
                      projectPartyId={party.id}
                      isActive={party.is_active}
                    />
                  )}
                </span>
              </div>
              {canProvisionPartyLogin && party.is_active && (
                <div className="mt-1.5">
                  <PartyMembersPanel
                    projectPartyId={party.id}
                    accessMode={party.access_mode}
                    members={partyMembersByPartyId.get(party.id) ?? []}
                    customRoles={orgCustomRoles}
                    primaryContactUserId={party.user_id}
                  />
                </div>
              )}
            </li>
          ))}
          {(parties ?? []).length === 0 && <li className="text-sm text-muted">No parties recorded on this project yet.</li>}
        </ul>
        {isAdminStaff(session) && <AddProjectPartyForm projectId={project.id} />}
        {canAddSelfManagedParty && <AddSelfManagedPartyForm projectId={project.id} />}
      </div>

      {isAdminStaff(session) && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">Checklist execution settings</h2>
          <p className="mt-1 text-sm text-muted">
            By default only the performing contractor (subcontractor/main contractor) self-inspects
            and fills in checklists — a client-type party only holds independent sign-off points.
            Turning this on lets a client-type party on THIS project also execute checklists,
            without changing behaviour on any other project.
          </p>
          <AllowClientExecutionToggle projectId={project.id} allowClientExecution={project.allow_client_execution} />
        </div>
      )}

      {isAdminStaff(session) && (
        <div className="mt-8">
          <ReviewChainForm projectId={project.id} staff={staffUsers} initialChain={reviewChain} />
        </div>
      )}

      {isAdminStaff(session) && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">ITP creation settings</h2>
          <p className="mt-1 text-sm text-muted">
            By default only JAGS staff create ITPs. Turning this on lets an active client-type party
            on THIS project also create and build out draft ITPs from scratch — JAGS still reviews
            and approves every ITP regardless of who created it; a client can only edit their own
            ITPs while they remain in draft.
          </p>
          <AllowClientItpCreationToggle
            projectId={project.id}
            allowClientItpCreation={project.allow_client_itp_creation}
          />
          <AllowContractorItpCreationToggle
            projectId={project.id}
            allowContractorItpCreation={project.allow_contractor_itp_creation}
          />
        </div>
      )}

      {isAdminStaff(session) && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">Standalone Assignment execution settings</h2>
          <p className="mt-1 text-sm text-muted">
            By default only JAGS staff can run a Standalone Assignment (FAT/witness inspection/
            specific test/pre-shipment) on this project, on any engagement tier. Turning this on
            lets an active subcontractor or main-contractor party on THIS project run one
            themselves too — the equipment they supplied is routinely something they're best
            placed to test. This works independently of the Full Client-Managed tier's own
            run_standalone_assignment permission (Organisation → Custom roles), which is separate
            and grants the same right to the client's own people instead.
          </p>
          <AllowContractorStandaloneAssignmentToggle
            projectId={project.id}
            allowContractorStandaloneAssignment={project.allow_contractor_standalone_assignment}
          />
        </div>
      )}

      {(isAdminStaff(session) || canAddSelfManagedParty) && (
        <div className="mt-4">
          <LocationPresetsSettings
            organizationId={project.organization_id}
            projectId={project.id}
            presets={projectLocationPresets}
          />
        </div>
      )}

      {isAdminStaff(session) && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">Hold-point enforcement</h2>
          <p className="mt-1 text-sm text-muted">
            On by default: an open Hold on an activity stops field work from starting at all, not
            just from being marked complete (R71 — "a hold point must wait"). Turn this off for
            THIS project only if its process doesn't need the software to enforce the hold at
            start time — the assigned party still has to sign off before the inspection can be
            completed either way.
          </p>
          <EnforceHoldBlocksStartToggle
            projectId={project.id}
            enforceHoldBlocksStart={project.enforce_hold_blocks_start}
          />
        </div>
      )}

      {isAdminStaff(session) && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">Notice period overrides</h2>
          <p className="mt-1 text-sm text-muted">
            How long an originator waits for a response before a level can be marked &ldquo;notified&rdquo; /
            proceed-without-response applies (R25). Set one value here per intervention level for
            THIS project, instead of overriding every individual activity — leave blank to keep
            using the organisation&apos;s own default for that level.
          </p>
          <NoticePeriodSettings
            projectId={project.id}
            levels={interventionLevels.map((l) => ({
              code: l.code,
              label: l.label,
              default_notice_hours: l.default_notice_hours,
            }))}
            configuredHours={noticePeriodConfigs}
          />
        </div>
      )}
    </div>
    </OrgBrandScope>
  );
}
