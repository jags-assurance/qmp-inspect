import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { OrgBrandScope } from "@/components/domain/org-brand-scope";
import { AddProjectPartyForm } from "./add-project-party-form";
import { ReassignPartyForm } from "./reassign-party-form";
import { AllowClientExecutionToggle } from "./allow-client-execution-toggle";
import { isTeamLeadForProject } from "@/lib/teams/helpers";

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
  organizations: {
    name: string;
    engagement_mode: string;
    brand_primary_color: string | null;
    brand_accent_color: string | null;
  } | null;
}

/**
 * The project-detail hub this app was missing: before this, registers/data-book/kpis/punch-list
 * were real, fully-built pages with no navigable entry point anywhere — only reachable by typing
 * the URL directly (see docs/MANUAL_TESTING_GUIDE.md, which does exactly that). This page is that
 * entry point, plus real per-project numbers computed here rather than guessed at.
 */
export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await requireSession();
  // Matches the same restriction the sidebar nav applies (apps/web/app/inspect/layout.tsx): a
  // client login has no reason to navigate to JAGS-run standalone/FAT work.
  const isClientRole = !session.isJagsStaff && session.grants.some((g) => g.role === "client");
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, project_number, name, site_location, country, contract_number, start_date, end_date, status, organization_id, allow_client_execution, organizations(name, engagement_mode, brand_primary_color, brand_accent_color)"
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
  ] = await Promise.all([
    supabase
      .from("project_parties")
      .select("id, name, party_type, is_active, onboarded_by, user_id, users(full_name, email)")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("party_type")
      .returns<
        {
          id: string;
          name: string;
          party_type: string;
          is_active: boolean;
          onboarded_by: "jags" | "client";
          user_id: string | null;
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
  ]);

  // Reassignment (piece 3) and the client-execution toggle (piece 4) are both sensitive, staff-only
  // affordances — gated the same way reassignSignoffPartyAction gates itself server-side: a JAGS
  // Admin, or a lead of a team actually assigned to this project. Computed once here so both the
  // party list and the settings toggle below use the identical check the server action re-verifies.
  const canReassign = isAdminStaff(session) || (await isTeamLeadForProject(supabase, session.userId, project.id));

  // Eligible reassignment targets: anyone whose access already reaches this project's organisation
  // (global/organisation/project-scoped access_grants) or this project specifically — a broader set
  // than only existing party-linked users, since reassignment is precisely for handing a party's
  // sign-off responsibility to someone who doesn't hold it yet.
  let eligibleUsers: { id: string; full_name: string; email: string }[] = [];
  if (canReassign) {
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
      <Link href="/inspect/projects" className="text-sm text-burgundy hover:underline">
        ← Back to Projects
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="doc-id text-sm text-muted">{project.project_number}</p>
          <h1 className="text-2xl font-semibold text-ink">{project.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {project.organizations?.name ?? "—"}
            {project.site_location && ` · ${project.site_location}`}
            {project.country && `, ${project.country}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>{project.status.replace("_", " ")}</Badge>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ITPs" value={itpCount ?? 0} />
        <StatCard label="Pending inspections" value={pendingInspectionCount ?? 0} />
        <StatCard label="Open NCRs" value={openNcrCount ?? 0} />
        <StatCard label="Open punch items" value={openPunchCount ?? 0} />
      </div>

      <div className="mt-8">
        <h2 className="font-medium text-ink">Project sections</h2>
        <p className="mt-1 text-sm text-muted">Everything scoped to this project.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <HubCard href={`/inspect/itps?project=${projectId}`} title="ITPs" description="Inspection & Test Plans for this project." />
          <HubCard href={`/inspect/ncrs?project=${projectId}`} title="NCRs" description="Minor and major non-conformances." />
          <HubCard href={`/inspect/observations?project=${projectId}`} title="Observations" description="Lighter findings, gradeable up to an NCR." />
          {!isClientRole && (
            <HubCard
              href={`/inspect/standalone?project=${projectId}`}
              title="Standalone assignments"
              description="FATs, witness inspections and one-off tests."
            />
          )}
          <HubCard href={`/inspect/vault?project=${projectId}`} title="Document Vault" description="Drawings, specs, certificates and controlled documents." />
          <HubCard href={`/inspect/projects/${projectId}/registers`} title="Registers" description="Calibration, welder qualification and material registers." />
          <HubCard href={`/inspect/projects/${projectId}/punch-list`} title="Punch List" description="Outstanding items across every source, open and closed." />
          <HubCard href={`/inspect/projects/${projectId}/data-book`} title="Data Book" description="Compile and issue the project's data book." />
          <HubCard href={`/inspect/projects/${projectId}/kpis`} title="Client KPIs" description="First-time pass rate, hold-point turnaround and more." />
          <HubCard href={`/inspect/projects/${projectId}/activity`} title="Activity" description="A live timeline of inspections, sign-offs and NCRs on this project." />
          <HubCard href={`/inspect/projects/${projectId}/reports`} title="Reports & Downloads" description="Monthly report packs and ITP documents for your organisation." />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">Project parties</h2>
        <p className="mt-1 text-sm text-muted">Every organisation engaged on this project.</p>
        <ul className="mt-4 space-y-2">
          {(parties ?? []).map((party) => (
            <li key={party.id} className="rounded-md border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink">{party.name}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={party.onboarded_by === "client" ? "info" : "neutral"}>
                    {party.onboarded_by === "client" ? "Client-onboarded" : "JAGS-onboarded"}
                  </Badge>
                  <span className="text-muted">{PARTY_TYPE_LABEL[party.party_type] ?? party.party_type}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>{party.users ? `${party.users.full_name} (${party.users.email})` : "No linked login yet"}</span>
                {canReassign && <ReassignPartyForm projectPartyId={party.id} eligibleUsers={eligibleUsers} />}
              </div>
            </li>
          ))}
          {(parties ?? []).length === 0 && <li className="text-sm text-muted">No parties recorded on this project yet.</li>}
        </ul>
        {isAdminStaff(session) && <AddProjectPartyForm projectId={project.id} />}
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
    </div>
    </OrgBrandScope>
  );
}

function HubCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-burgundy hover:bg-off-white"
    >
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </Link>
  );
}
