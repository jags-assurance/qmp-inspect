import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { loadNextSteps } from "@/lib/dashboard/next-steps";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom, untypedRpc } from "@/lib/supabase/untyped";
import { getActiveProjectId } from "@/lib/projects/active-project-server";
import { buildJourney, journeyProgress, journeyPhases, ROLE_TITLE, type JourneyFacts, type JourneyRole } from "@/lib/journey/steps";
import { getTranslator } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { cn } from "@/lib/cn";
import { JourneyLink } from "./journey-link";

export const metadata: Metadata = { title: "Workflow" };
export const maxDuration = 300;

type CountResult = PromiseLike<{ count: number | null; error: unknown }>;
/** A count that never breaks the page: a failed query reads as 0 and the step simply shows as not done. */
async function nCount(q: CountResult, miss: { count: number }): Promise<number> {
  try {
    const r = await q;
    if (r.error) miss.count++;
    return r.error ? 0 : (r.count ?? 0);
  } catch {
    miss.count++;
    return 0;
  }
}

export default async function JourneyPage({ searchParams }: { searchParams: Promise<{ org?: string; project?: string }> }) {
  const tl = await getTranslator();
  const session = await requireSession();
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  const admin = isAdminStaff(session);
  const { data: orgs, error: orgsError } = admin
    ? await supabase
        .from("organizations")
        .select("id, name")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };
  const orgList = orgs ?? [];
  if (admin && orgsError) {
    return (
      <div className="space-y-3" role="alert">
        <PageHeader title={<Tx>Workflow</Tx>} />
        <p className="rounded-lg border border-warning/60 bg-warning/10 p-4 text-sm text-ink">
          <Tx>The workflow could not be loaded just now (the database was slow). Reload the page in a moment.</Tx>
        </p>
      </div>
    );
  }
  const org = orgList.find((o) => o.id === sp.org) ?? orgList[0] ?? null;

  type ProjRow = { id: string; project_number: string; name: string; status: string; allow_contractor_itp_creation: boolean; allow_client_itp_creation: boolean };
  let projQuery = supabase
    .from("projects")
    .select("id, project_number, name, status, allow_contractor_itp_creation, allow_client_itp_creation")
    .order("created_at", { ascending: false })
    .limit(200);
  if (admin && org) projQuery = projQuery.eq("organization_id", org.id);
  const { data: projs } = admin && !org ? { data: [] as ProjRow[] } : await projQuery.returns<ProjRow[]>();
  const projectList = projs ?? [];

  // Which journey this login follows.
  const { data: ownParties } = admin
    ? { data: [] as { id: string; party_type: string }[] }
    : await supabase.from("project_parties").select("id, party_type").eq("user_id", session.userId).returns<{ id: string; party_type: string }[]>();
  const partyIds = (ownParties ?? []).map((p) => p.id);
  const role: JourneyRole = admin
    ? "admin"
    : session.isJagsStaff
      ? "engineer"
      : session.grants.some((g) => g.role === "client")
        ? "client"
        : ownParties?.[0]?.party_type === "tpi_lab"
          ? "tpi"
          : "contractor";
  const activeId = await getActiveProjectId();
  const project = projectList.find((p) => p.id === sp.project) ?? projectList.find((p) => p.id === activeId) ?? projectList[0] ?? null;
  const pid = project?.id ?? null;
  // Reads that failed (a slow database) read as 0; count them so the page can say so instead of showing a step as not done.
  const miss = { count: 0 };
  const n = (q: CountResult) => nCount(q, miss);
  const none = Promise.resolve({ count: 0, error: null });
  const head = { count: "exact", head: true } as const;
  const q = (table: string) => untypedFrom(supabase, table).select("id", head);

  // One database call for all the counts when the function exists (migration 20261214000100); otherwise the
  // separate count queries below do the same job.
  const rpcRes = org || pid ? await untypedRpc(supabase, "journey_facts", { p_org_id: org?.id ?? null, p_project_id: pid }) : null;
  const jfRaw = rpcRes && !rpcRes.error && rpcRes.data && typeof rpcRes.data === "object" ? (rpcRes.data as Record<string, number>) : null;
  // Only trust the function when it counts inspections per checklist (version 2); older copies over-count re-inspections.
  const jf = jfRaw && jfRaw.v === 2 ? jfRaw : null;
  const booksQuery = pid
    ? supabase.from("data_books").select("id, status").eq("project_id", pid).returns<{ id: string; status: string }[]>()
    : Promise.resolve({ data: [] as { id: string; status: string }[] });
  const pendingQuery = role === "admin" ? null : loadNextSteps(supabase, { partyIds, staff: session.isJagsStaff, limit: 1 }).catch(() => null);

  const [
    numbering, teams, parties, vault, calib, mat, weld, pers, itps, approved, inspections, ncrs, punch, irns, books,
    itpDraft, itpAwaitingClient, inProgress, passed, checklists, noLogin, signoffAll, signoffOpen, activities, pending,
  ] = jf
    ? await Promise.all([
        jf.numbering ?? 0, jf.teams ?? 0, jf.parties ?? 0, jf.vault ?? 0, jf.calibration ?? 0, jf.material ?? 0, jf.welder ?? 0, jf.personnel ?? 0,
        jf.itps ?? 0, jf.itps_approved ?? 0, jf.inspections_done ?? 0, jf.ncrs_open ?? 0, jf.punch_open ?? 0, jf.irns ?? 0, booksQuery,
        jf.itps_draft ?? 0, jf.itps_awaiting_client ?? 0, jf.inspections_open ?? 0, jf.inspections_pass ?? 0, jf.checklists ?? 0,
        jf.parties_no_login ?? 0, jf.signoff_total ?? 0, jf.signoff_open ?? 0, jf.activities ?? 0, pendingQuery,
      ])
    : await Promise.all([
    admin && org ? n(untypedFrom(supabase, "numbering_configs").select("id", head).eq("organization_id", org.id)) : none.then((r) => r.count),
    admin ? n(untypedFrom(supabase, "teams").select("id", head)) : 0,
    pid ? n(q("project_parties").eq("project_id", pid)) : 0,
    pid ? n(untypedFrom(supabase, "vault_documents").select("id, vault_folders!inner(project_id)", head).eq("vault_folders.project_id", pid)) : 0,
    pid ? n(q("calibration_register").eq("project_id", pid)) : 0,
    pid ? n(q("material_register").eq("project_id", pid)) : 0,
    pid ? n(q("welder_qualification_register").eq("project_id", pid)) : 0,
    pid ? n(q("personnel_certifications").eq("project_id", pid)) : 0,
    pid ? n(q("itps").eq("project_id", pid)) : 0,
    pid ? n(q("itps").eq("project_id", pid).in("status", ["approved", "client_accepted"])) : 0,
    pid
      ? Promise.resolve(untypedFrom(supabase, "inspection_records").select("itp_item_id").eq("project_id", pid).not("overall_result", "is", null).limit(5000)).then((r) => {
          if (r.error) {
            miss.count++;
            return 0;
          }
          return new Set(((r.data ?? []) as { itp_item_id: string }[]).map((x) => x.itp_item_id)).size;
        })
      : 0,
    pid ? n(q("ncrs").eq("project_id", pid).neq("status", "closed")) : 0,
    pid ? n(q("punch_list_items").eq("project_id", pid).eq("status", "open")) : 0,
    pid ? n(untypedFrom(supabase, "irns").select("id, inspection_records!inner(project_id)", head).eq("inspection_records.project_id", pid)) : 0,
    pid
      ? supabase.from("data_books").select("id, status").eq("project_id", pid).returns<{ id: string; status: string }[]>()
      : Promise.resolve({ data: [] as { id: string; status: string }[] }),
    pid ? n(q("itps").eq("project_id", pid).eq("status", "draft")) : 0,
    pid ? n(q("itps").eq("project_id", pid).eq("status", "approved")) : 0,
    pid ? n(q("inspection_records").eq("project_id", pid).is("overall_result", null)) : 0,
    pid ? n(q("inspection_records").eq("project_id", pid).eq("overall_result", "pass")) : 0,
    pid ? n(untypedFrom(supabase, "checklist_templates").select("id, itp_items!inner(itp_sections!inner(itps!inner(project_id)))", head).eq("itp_items.itp_sections.itps.project_id", pid)) : 0,
    pid ? n(q("project_parties").eq("project_id", pid).is("user_id", null)) : 0,
    pid ? n(untypedFrom(supabase, "activity_signoff_progress").select("id, itp_items!inner(itp_sections!inner(itps!inner(project_id)))", head).eq("itp_items.itp_sections.itps.project_id", pid)) : 0,
    pid ? n(untypedFrom(supabase, "activity_signoff_progress").select("id, itp_items!inner(itp_sections!inner(itps!inner(project_id)))", head).eq("itp_items.itp_sections.itps.project_id", pid).in("status", ["pending", "notified"])) : 0,
    pid ? n(untypedFrom(supabase, "itp_items").select("id, itp_sections!inner(itps!inner(project_id))", head).eq("itp_sections.itps.project_id", pid)) : 0,
    role === "admin" ? null : loadNextSteps(supabase, { partyIds, staff: session.isJagsStaff, limit: 1 }).catch(() => null),
  ]);
  const bookRows = books.data ?? [];
  const bookStatus: JourneyFacts["dataBookStatus"] = bookRows.some((b) => b.status === "issued")
    ? "issued"
    : bookRows.some((b) => b.status === "compiled")
      ? "compiled"
      : bookRows.length
        ? "draft"
        : "none";
  let handoverIssued = false;
  let handoverAcknowledged = false;
  if (bookRows.length) {
    const { data: certs } = await supabase
      .from("handover_certificates")
      .select("acknowledged_at")
      .in("data_book_id", bookRows.map((b) => b.id))
      .returns<{ acknowledged_at: string | null }[]>();
    handoverIssued = (certs ?? []).length > 0;
    handoverAcknowledged = (certs ?? []).some((c) => c.acknowledged_at);
  }
  let firstApprovedItpId: string | null = null;
  if (pid && approved > 0) {
    const { data } = await supabase
      .from("itps")
      .select("id")
      .eq("project_id", pid)
      .in("status", ["approved", "client_accepted"])
      .order("created_at")
      .limit(1)
      .maybeSingle<{ id: string }>();
    firstApprovedItpId = data?.id ?? null;
  }

  const facts: JourneyFacts = {
    organisationId: org?.id ?? null,
    projectId: pid,
    hasNumbering: numbering > 0,
    teamCount: teams,
    projectCount: projectList.length,
    partyCount: parties,
    vaultDocCount: vault,
    registerCount: calib + mat + weld + pers,
    itpTotal: itps,
    itpActivityCount: activities,
    itpApproved: approved,
    firstApprovedItpId,
    inspectionCount: inspections,
    openNcrCount: ncrs,
    openPunchCount: punch,
    irnCount: irns,
    dataBookStatus: bookStatus,
    handoverIssued,
    handoverAcknowledged,
    projectCompleted: project?.status === "completed",
    inspectionsPassed: passed,
    checklistTotal: checklists,
    partiesWithoutLogin: noLogin,
    signoffTotal: signoffAll,
    signoffOutstanding: signoffOpen,
    pendingSignoffs: pending?.total ?? 0,
    firstSignoffHref: pending?.items[0]?.href ?? null,
    itpDraft,
    // A completed project is closed to changes, so nothing is waiting for acceptance any more.
    itpAwaitingClient: project?.status === "completed" ? 0 : itpAwaitingClient,
    inspectionsInProgress: inProgress,
    canCreateItp: role === "client" ? !!project?.allow_client_itp_creation : !!project?.allow_contractor_itp_creation,
  };
  const steps = buildJourney(facts, role);
  const phases = journeyPhases(steps);
  const progress = journeyProgress(steps);
  const next = steps.find((s) => s.state === "next") ?? null;
  const ctx = JSON.stringify({ org: org?.id ?? null, project: pid });

  return (
    <div className="space-y-6">
      <PageHeader
        title={<Tx>Workflow</Tx>}
        subtitle={<Tx>{`${ROLE_TITLE[role]}. Open a step, finish it, and come back here.`}</Tx>}
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
        {admin && (
        <label className="text-sm">
          <span className="mb-1 block font-medium text-ink"><Tx>Organisation</Tx></span>
          <select name="org" defaultValue={org?.id ?? ""} className="min-h-11 rounded-md border border-control-border bg-surface px-3 text-sm">
            {orgList.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
          </select>
        </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block font-medium text-ink"><Tx>Project</Tx></span>
          <select name="project" defaultValue={pid ?? ""} className="min-h-11 rounded-md border border-control-border bg-surface px-3 text-sm">
            {projectList.length === 0 && <option value="">{tl("(none yet)")}</option>}
            {projectList.map((p) => (<option key={p.id} value={p.id}>{p.project_number} — {p.name}</option>))}
          </select>
        </label>
        <button type="submit" className={buttonVariants({ variant: "outline" })}><Tx>Show</Tx></button>
        <p className="ms-auto text-sm text-muted">
          {progress.done} / {progress.total} <Tx>required steps done</Tx>
        </p>
      </form>
      <div className="h-2 overflow-hidden rounded-full bg-surface-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <div className="h-full bg-success" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
      </div>

      {miss.count > 0 && (
        <p role="alert" className="rounded-lg border border-warning/60 bg-warning/10 p-3 text-sm text-ink">
          <Tx>Some progress numbers could not be loaded just now (the database was slow), so a step may look unfinished. Reload the page in a moment.</Tx>
        </p>
      )}

      {next && (
        <section aria-label="Do this next" className="rounded-lg border-2 border-success/60 bg-success/5 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-success"><Tx>Do this next</Tx></p>
          <h2 className="mt-1 text-lg font-semibold text-ink"><Tx>{next.title}</Tx></h2>
          <p className="mt-1 text-sm text-muted"><Tx>{next.help}</Tx></p>
          <div className="mt-3">
            <JourneyLink href={next.href} ctx={ctx} stepTitle={next.title} className={buttonVariants({ variant: "primary" })}>
              {next.action} →
            </JourneyLink>
          </div>
        </section>
      )}
      {!next && (
        <p className="rounded-lg border border-success/60 bg-success/5 p-4 text-sm text-ink"><Tx>All required steps are done. The project is handed over.</Tx></p>
      )}

      {phases.map((phase, i) => {
        const items = steps.filter((s) => s.phase === phase);
        return (
          <section key={phase} className="space-y-2">
            <h2 className="text-base font-semibold text-ink">
              <span className="me-2 text-muted">{i + 1}.</span><Tx>{phase}</Tx>
            </h2>
            <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
              {items.map((s) => (
                <li key={s.key} className={cn("flex flex-wrap items-start gap-3 p-4", s.state === "next" && "bg-success/5")}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                      s.state === "done" ? "border-success bg-success text-white" : s.state === "next" ? "border-success bg-success/15 text-success" : "border-control-border text-muted"
                    )}
                  >
                    {s.state === "done" ? "✓" : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      <Tx>{s.title}</Tx>
                      {s.optional && <Badge tone="neutral"><Tx>Optional</Tx></Badge>}
                      {s.state === "done" && <Badge tone="success"><Tx>Done</Tx></Badge>}
                      {s.state === "next" && <Badge tone="info"><Tx>Next</Tx></Badge>}
                    </p>
                    <p className="mt-0.5 text-sm text-muted"><Tx>{s.help}</Tx></p>
                    {s.note && <p className="mt-0.5 text-xs text-muted">{s.note}</p>}
                    {s.needsProject && !pid && <p className="mt-0.5 text-xs text-warning"><Tx>Create the project first.</Tx></p>}
                  </div>
                  <JourneyLink
                    href={s.href}
                    ctx={ctx}
                    stepTitle={s.title}
                    className={buttonVariants({ variant: s.state === "next" ? "primary" : "outline" })}
                  >
                    {s.state === "done" ? "Open" : s.action}
                  </JourneyLink>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      <p className="text-sm text-muted">
        <Tx>Need a reminder of what each area does?</Tx> <Link href="/inspect/guide" className="underline"><Tx>Open the guide</Tx></Link>.
      </p>
    </div>
  );
}
