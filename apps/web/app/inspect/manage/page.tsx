import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE, resolveActiveOrgId } from "@/lib/organizations/active-org";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { ITP_STATUS_LABEL, ITP_STATUS_TONE } from "../itps/itp-status";
import { PageGuide } from "@/components/domain/page-guide";
import { hasPermission } from "@/lib/rbac/permissions";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Manage" };

/**
 * Consolidated self-service hub for a Self-Managed client's own org — everything they can already
 * do across separate pages (build/submit ITPs, generate checklists, accept approved ITPs, manage
 * parties/teams/roles/branding/numbering) in one place, plus an "action queue" surfacing exactly
 * which of their own ITPs need something from them right now. Nothing here grants a new permission
 * on its own — it reads the same RLS-backed data every linked page already reads, and the action
 * queue's three buttons (Submit for review, Generate checklists, Accept ITP) are the same ones on
 * the ITP detail/checklists pages, gated the same way (see 20260921000000_self_managed_submit_and_
 * checklist_gen.sql for what's newly self-service vs. what stays JAGS-only — Approve, Close NCR,
 * and Issue IRN never appear here because they never became self-service).
 *
 * JAGS staff never need this page (they already see every org via the ordinary nav), so it
 * redirects them straight back — mirrors the "Numbering"/"Brand Colors" self-managed-only pages.
 */
export default async function ManageHubPage() {
  const tl = await getTranslator();
  const session = await requireSession();
  if (session.isJagsStaff) redirect("/inspect");

  const supabase = await createSupabaseServerClient();

  const ownOrgId = resolveActiveOrgId(session.grants, (await cookies()).get(ACTIVE_ORG_COOKIE)?.value);
  if (!ownOrgId) redirect("/inspect");

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, engagement_scope")
    .eq("id", ownOrgId)
    .maybeSingle<{ id: string; name: string; engagement_scope: string }>();

  if (!org || (org.engagement_scope !== "self_managed" && org.engagement_scope !== "client_managed")) redirect("/inspect");
  const isClientManaged = org.engagement_scope === "client_managed";

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name, allow_client_itp_creation, allow_contractor_itp_creation")
    .eq("organization_id", ownOrgId)
    .order("created_at", { ascending: false })
    .returns<
      { id: string; project_number: string; name: string; allow_client_itp_creation: boolean; allow_contractor_itp_creation: boolean }[]
    >();

  const projectIds = (projects ?? []).map((p) => p.id);
  const projectById = new Map((projects ?? []).map((p) => [p.id, p]));

  const [{ data: itps }, { data: myParties }] = projectIds.length
    ? await Promise.all([
        supabase
          .from("itps")
          .select("id, itp_number, title, status, project_id")
          .in("project_id", projectIds)
          .returns<{ id: string; itp_number: string; title: string; status: string; project_id: string }[]>(),
        supabase
          .from("project_parties")
          .select("project_id, party_type, is_active")
          .in("project_id", projectIds)
          .eq("user_id", session.userId)
          .returns<{ project_id: string; party_type: string; is_active: boolean }[]>(),
      ])
    : [{ data: [] }, { data: [] }];

  const myPartyByProject = new Map((myParties ?? []).filter((p) => p.is_active).map((p) => [p.project_id, p.party_type]));

  function isEligibleCreator(projectId: string): boolean {
    const partyType = myPartyByProject.get(projectId);
    const project = projectById.get(projectId);
    if (!partyType || !project) return false;
    // This page only ever renders for a self_managed or client_managed org (redirected away
    // otherwise, above), and is_client_itp_creator treats either tier's client party as eligible
    // unconditionally — so there's no flag to check here, unlike the contractor branch below.
    if (partyType === "client") return true;
    if (partyType === "subcontractor" || partyType === "main_contractor") return project.allow_contractor_itp_creation;
    return false;
  }

  // Full Client-Managed tier's approval half: only shown when this specific person holds the
  // approve_itp custom permission on the ITP's own project (see CLIENT_MANAGED_ONLY_PERMISSION_KEYS)
  // — never true for a plain Self-Managed ("Hybrid") org, which always needs JAGS to approve.
  const underReviewProjectIds = isClientManaged
    ? [...new Set((itps ?? []).filter((itp) => itp.status === "under_review").map((itp) => itp.project_id))]
    : [];
  const approvableProjectIds = new Set(
    (
      await Promise.all(
        underReviewProjectIds.map(async (projectId) => ({
          projectId,
          canApprove: await hasPermission(session.userId, "approve_itp", projectId),
        }))
      )
    )
      .filter((r) => r.canApprove)
      .map((r) => r.projectId)
  );

  const actionQueue = (itps ?? [])
    .map((itp) => {
      const eligible = isEligibleCreator(itp.project_id);
      const partyType = myPartyByProject.get(itp.project_id);
      if (itp.status === "draft" && eligible) {
        return { ...itp, action: "Submit for review" as const };
      }
      if (itp.status === "under_review" && approvableProjectIds.has(itp.project_id)) {
        return { ...itp, action: "Approve ITP" as const };
      }
      if (itp.status === "approved" && partyType === "client") {
        return { ...itp, action: "Accept ITP" as const };
      }
      if (itp.status === "approved" && eligible) {
        return { ...itp, action: "Generate checklists" as const };
      }
      return null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const queueColumns: ResponsiveColumn<(typeof actionQueue)[number]>[] = [
    {
      key: "itp",
      header: "ITP",
      render: (row) => (
        <div className="text-start">
          <Link href={`/inspect/itps/${row.id}`} className="doc-id text-burgundy hover:underline">
            {row.itp_number}
          </Link>
          <div className="text-xs text-muted">{row.title}</div>
        </div>
      ),
    },
    { key: "project", header: "Project", className: "text-muted", render: (row) => projectById.get(row.project_id)?.project_number },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={ITP_STATUS_TONE[row.status] ?? "neutral"}>{ITP_STATUS_LABEL[row.status] ?? row.status}</Badge>,
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <Link
          href={row.action === "Generate checklists" ? `/inspect/itps/${row.id}/checklists` : `/inspect/itps/${row.id}`}
          className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium hover:bg-off-white sm:min-h-0"
        >
          {row.action} →
        </Link>
      ),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink"><T>Manage —</T> {org.name}</h1>
        <PageGuide
          title={tl("Manage — how this works")}
          points={[
            "Only shown to Self-Managed and Full Client-Managed client organisations, and only for your own org — JAGS staff never see this page, they use the ordinary nav instead.",
            "\"Needs your action\" surfaces exactly what's waiting on you: submitting your own draft ITPs, generating checklists once an ITP you can create for is approved, accepting an ITP if you're the client party, and — Full Client-Managed only, and only if you hold the approve_itp custom permission — approving an ITP yourself.",
            "Nothing here grants a new permission — it's the same RLS-scoped data and the same gated actions the ITP detail/checklists pages already expose, just gathered in one place.",
            "Closing an NCR and issuing an IRN are never self-service, even here — those stay JAGS-only by design, as the independent check. Approving is JAGS-only on Self-Managed (Hybrid); it becomes self-service only on Full Client-Managed, and only for whoever's granted that permission.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        {isClientManaged ? "Full Client-Managed" : "Self-Managed"} <T>organisation. JAGS still closes every NCR and issues every IRN.</T>
        {!isClientManaged && " JAGS also still approves every ITP."}
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-ink"><T>Needs your action</T></h2>
        {actionQueue.length === 0 ? (
          <p className="mt-2 rounded-lg border border-border bg-off-white p-4 text-sm text-muted">
            <T>Nothing waiting on you right now.</T>
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
            <ResponsiveTable
              columns={queueColumns}
              rows={actionQueue}
              rowKey={(row) => row.id}
              caption="ITPs needing action"
              wrapperClassName=""
              theadClassName="border-b border-border bg-off-white text-start text-xs uppercase tracking-wide text-muted"
              headRowClassName=""
              thClassName="px-4 py-2"
              tdClassName="px-4 py-2"
              cardClassName="px-4"
            />
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink"><T>Your projects</T></h2>
        {(projects ?? []).length === 0 ? (
          <p className="mt-2 rounded-lg border border-border bg-off-white p-4 text-sm text-muted">
            <T>No projects yet —</T> <Link href="/inspect/projects/new" className="text-burgundy hover:underline"><T>create one</T></Link>.
          </p>
        ) : (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {(projects ?? []).map((project) => (
              <div key={project.id} className="rounded-lg border border-border bg-surface p-4">
                <p className="doc-id text-sm text-muted">{project.project_number}</p>
                <p className="font-medium text-ink">{project.name}</p>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-burgundy">
                  <Link href={`/inspect/projects/${project.id}`} className="hover:underline"><T>Parties</T></Link>
                  <Link href={`/inspect/projects/${project.id}/kpis`} className="hover:underline"><T>KPIs</T></Link>
                  <Link href={`/inspect/projects/${project.id}/reports`} className="hover:underline"><T>Reports</T></Link>
                  <Link href={`/inspect/projects/${project.id}/registers`} className="hover:underline"><T>Registers</T></Link>
                  <Link href={`/inspect/projects/${project.id}/punch-list`} className="hover:underline"><T>Punch List</T></Link>
                  <Link href={`/inspect/projects/${project.id}/data-book`} className="hover:underline"><T>Data Book</T></Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink"><T>Organisation settings</T></h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/inspect/organisation/client-teams" className="rounded-lg border border-border bg-surface p-4 hover:border-burgundy hover:bg-off-white">
            <p className="font-medium text-ink"><T>Client Teams</T></p>
            <p className="mt-1 text-sm text-muted"><T>Group your own people by team</T></p>
          </Link>
          <Link href="/inspect/organisation/roles" className="rounded-lg border border-border bg-surface p-4 hover:border-burgundy hover:bg-off-white">
            <p className="font-medium text-ink"><T>Custom Roles</T></p>
            <p className="mt-1 text-sm text-muted"><T>Delegate permissions within your org</T></p>
          </Link>
          <Link href="/inspect/organisation/numbering" className="rounded-lg border border-border bg-surface p-4 hover:border-burgundy hover:bg-off-white">
            <p className="font-medium text-ink"><T>Numbering</T></p>
            <p className="mt-1 text-sm text-muted"><T>Your own document numbering format</T></p>
          </Link>
          <Link href="/inspect/organisation/branding" className="rounded-lg border border-border bg-surface p-4 hover:border-burgundy hover:bg-off-white">
            <p className="font-medium text-ink"><T>Brand Colors</T></p>
            <p className="mt-1 text-sm text-muted"><T>Accent colour on your generated PDFs</T></p>
          </Link>
        </div>
      </section>
    </div>
  );
}
