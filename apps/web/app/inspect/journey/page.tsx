import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { loadNextSteps } from "@/lib/dashboard/next-steps";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
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
async function n(q: CountResult): Promise<number> {
  try {
    const r = await q;
    return r.error ? 0 : (r.count ?? 0);
  } catch {
    return 0;
  }
}

export default async function JourneyPage({ searchParams }: { searchParams: Promise<{ org?: string; project?: string }> }) {
  const tl = await getTranslator();
  const session = await requireSession();
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  const admin = isAdminStaff(session);
  const { data: orgs } = admin
    ? await supabase
        .from("organizations")
        .select("id, name")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };
  const orgList = orgs ?? [];
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
  const none = Promise.resolve({ count: 0, error: null });
  const head = { count: "exact", head: true } as const;
  const q = (table: string) => untypedFrom(supabase, table).select("id", head);

  const [
    numbering, teams, parties, vault, calib, mat, weld, pers, itps, approved, inspections, ncrs, punch, irns, books,
    itpDraft, itpAwaitingClient, inProgress, pending,
  ] = await Promise.all([
    admin && org ? n(untypedFrom(supabase, "numbering_configs").select("id", head).eq("organization_id", org.id)) : none.then((r) => r.count),
    admin && org ? n(untypedFrom(supabase, "teams").select("id", head).eq("organization_id", org.id)) : none.then((r) => r.count),
    pid ? n(q("project_parties").eq("project_id", pid)) : 0,
    pid ? n(q("vault_documents").eq("project_id", pid)) : 0,
    pid ? n(q("calibration_register").eq("project_id", pid)) : 0,
    pid ? n(q("material_register").eq("project_id", pid)) : 0,
    pid ? n(q("welder_qualification_register").eq("project_id", pid)) : 0,
    pid ? n(q("personnel_certifications").eq("project_id", pid)) : 0,
    pid ? n(q("itps").eq("project_id", pid)) : 0,
    pid ? n(q("itps").eq("project_id", pid).in("status", ["approved", "client_accepted"])) : 0,
    pid ? n(q("inspection_records").eq("project_id", pid).not("overall_result", "is", null)) : 0,
    pid ? n(q("ncrs").eq("project_id", pid).neq("status", "closed")) : 0,
    pid ? n(q("punch_list_items").eq("project_id", pid).eq("status", "open")) : 0,
    pid ? n(untypedFrom(supabase, "irns").select("id, inspection_records!inner(project_id)", head).eq("inspection_records.project_id", pid)) : 0,
    pid
      ? supabase.from("data_books").select("id, status").eq("project_id", pid).returns<{ id: string; status: string }[]>()
      : Promise.resolve({ data: [] as { id: string; status: string }[] }),
    pid ? n(q("itps").eq("project_id", pid).eq("status", "draft")) : 0,
    pid ? n(q("itps").eq("project_id", pid).eq("status", "approved")) : 0,
    pid ? n(q("inspection_records").eq("project_id", pid).is("overall_result", null)) : 0,
    role === "admin" ? 0 : loadNextSteps(supabase, { partyIds, staff: session.isJagsStaff, limit: 1 }).then((r) => r.total).catch(() => 0),
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
    pendingSignoffs: pending,
    itpDraft,
    itpAwaitingClient,
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
