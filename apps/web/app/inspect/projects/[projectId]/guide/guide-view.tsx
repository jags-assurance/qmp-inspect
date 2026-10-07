import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";

const PARTY_TYPE_LABEL: Record<string, string> = {
  client: "Client",
  main_contractor: "Main Contractor",
  subcontractor: "Subcontractor",
  tpi_lab: "TPI / Lab",
  vendor: "Vendor",
  jags: "JAGS Assurance",
};

const PARTY_TYPE_RESPONSIBILITY: Record<string, string> = {
  client: "Reviews and accepts finished ITPs, holds any Hold/Review points reserved for you, acknowledges the final Handover package.",
  main_contractor: "Delivers the physical work, typically holds Witness-level oversight across most activities, and can always self-execute (run) ITP checklists for its own work by default (Standalone/FAT assignments remain JAGS-staff-only).",
  subcontractor: "Executes a specific scope of physical work, sign off is limited to your own party's cells on the grid.",
  tpi_lab: "Independent verification — reviews/witnesses but never physically executes the checklist.",
  vendor: "Supplies material/equipment; involvement is usually limited to specific submittal or material-certificate checks.",
  jags: "Runs the inspection process itself — builds ITPs, executes checklists, raises NCRs, issues IRNs.",
};

const PARTY_TYPE_TONE: Record<string, "gold" | "info" | "success" | "warning" | "neutral"> = {
  client: "gold",
  jags: "success",
  main_contractor: "info",
  subcontractor: "info",
  tpi_lab: "warning",
  vendor: "neutral",
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** A live, real-numbers stacked bar — not decoration: each segment's width is proportional to its
 *  actual count, so the shape of the bar itself communicates "mostly done" vs "mostly still open"
 *  at a glance, the way a real portfolio dashboard would. */
function PipelineBar({ segments }: { segments: { label: string; count: number; colorClass: string }[] }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0) || 1;
  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-full border border-border">
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.label}
              className={`${s.colorClass} flex items-center justify-center text-[10px] font-semibold text-white`}
              style={{ width: `${(s.count / total) * 100}%` }}
              title={`${s.label}: ${s.count}`}
            >
              {s.count / total > 0.12 ? s.count : ""}
            </div>
          ) : null
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.colorClass}`} />
            {s.label} ({s.count})
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * "Who's on this project and what's expected of them" — distinct from the Data Book (which answers
 * "is this project done yet, as a %"). This answers "who am I on this project, what am I actually
 * responsible for, and what's the real state of the pipeline right now" — the confusion this was
 * built to resolve (found live this session): a login landing on a project with no orientation at
 * all beyond a stat-card hub.
 */
export async function GuideView({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, site_location, country, contract_number, status, organization_id, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{
      id: string;
      project_number: string;
      name: string;
      site_location: string | null;
      country: string | null;
      contract_number: string | null;
      status: string;
      organization_id: string;
      organizations: { name: string } | null;
    }>();

  if (!project) notFound();

  const [{ data: parties }, { data: itps }, { data: ncrs }, { count: openPunchCount }, { count: closedPunchCount }] = await Promise.all([
    supabase
      .from("project_parties")
      .select("id, party_type, name, user_id, is_active")
      .eq("project_id", projectId)
      .order("party_type")
      .returns<{ id: string; party_type: string; name: string; user_id: string | null; is_active: boolean }[]>(),
    supabase.from("itps").select("id, status, applicable_standard").eq("project_id", projectId).returns<{ id: string; status: string; applicable_standard: string | null }[]>(),
    supabase.from("ncrs").select("id, status").eq("project_id", projectId).returns<{ id: string; status: string }[]>(),
    supabase.from("punch_list_items").select("id", { count: "exact", head: true }).eq("project_id", projectId).neq("status", "closed"),
    supabase.from("punch_list_items").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("status", "closed"),
  ]);

  const myParty = (parties ?? []).find((p) => p.user_id === session.userId) ?? null;
  const isMyProjectRole = !session.isJagsStaff && myParty;

  const itpsByStatus = (itps ?? []).reduce<Record<string, number>>((acc, itp) => {
    acc[itp.status] = (acc[itp.status] ?? 0) + 1;
    return acc;
  }, {});
  const standards = [...new Set((itps ?? []).map((i) => i.applicable_standard).filter(Boolean))] as string[];
  const closedNcrCount = (ncrs ?? []).filter((n) => n.status === "closed").length;
  const openNcrCount = (ncrs ?? []).length - closedNcrCount;

  const itpSegments = [
    { label: "Draft", count: itpsByStatus.draft ?? 0, colorClass: "bg-muted" },
    { label: "Under review", count: itpsByStatus.under_review ?? 0, colorClass: "bg-warning" },
    { label: "Approved", count: itpsByStatus.approved ?? 0, colorClass: "bg-info" },
    { label: "Client accepted", count: itpsByStatus.client_accepted ?? 0, colorClass: "bg-success" },
  ];
  const ncrSegments = [
    { label: "Open", count: openNcrCount, colorClass: "bg-danger" },
    { label: "Closed", count: closedNcrCount, colorClass: "bg-success" },
  ];
  const punchSegments = [
    { label: "Open", count: openPunchCount ?? 0, colorClass: "bg-danger" },
    { label: "Closed", count: closedPunchCount ?? 0, colorClass: "bg-success" },
  ];

  // Real-time, not static copy: this reads the SAME live counts as the pipeline bars below, so as
  // the project actually moves (an ITP gets approved, the last punch item closes) this message
  // changes on its own on next page load — never a fixed "what to do" paragraph someone has to
  // remember to go update by hand.
  const totalItps = (itps ?? []).length;
  const approvedOrBetter = (itpsByStatus.approved ?? 0) + (itpsByStatus.client_accepted ?? 0);
  const openItemCount = openNcrCount + (openPunchCount ?? 0);

  type Phase = { label: string; tone: "neutral" | "warning" | "info" | "success" | "danger"; body: string; nextAction: string; nextHref: string };
  let phase: Phase;
  if (project.status === "on_hold") {
    phase = {
      label: "On hold",
      tone: "warning",
      body: "This project is currently paused — no new field work should be started until it's reactivated.",
      nextAction: "Check with your JAGS Admin before proceeding.",
      nextHref: `/inspect/projects/${projectId}`,
    };
  } else if (project.status === "cancelled") {
    phase = {
      label: "Cancelled",
      tone: "danger",
      body: "This project has been cancelled — nothing further should be actioned on it.",
      nextAction: "",
      nextHref: `/inspect/projects/${projectId}`,
    };
  } else if (totalItps === 0) {
    phase = {
      label: "Setting up",
      tone: "neutral",
      body: "No ITPs have been created yet — the project exists, but the actual inspection plan hasn't started.",
      nextAction: "Build the first ITP",
      nextHref: "/inspect/itps/new",
    };
  } else if (approvedOrBetter === 0) {
    phase = {
      label: "Planning",
      tone: "info",
      body: `${totalItps} ITP${totalItps === 1 ? "" : "s"} drafted so far, none approved yet — checklists and field inspections can't start until at least one is Approved.`,
      nextAction: "Review and approve the drafted ITPs",
      nextHref: "/inspect/itps",
    };
  } else if (openItemCount > 0) {
    phase = {
      label: "In execution",
      tone: "warning",
      body: `Inspections are running — ${approvedOrBetter} ITP${approvedOrBetter === 1 ? "" : "s"} approved, but ${openItemCount} item${openItemCount === 1 ? "" : "s"} (NCRs + punch list) still open and need resolving.`,
      nextAction: "Work through the open Punch List / NCRs",
      nextHref: `/inspect/projects/${projectId}/punch-list`,
    };
  } else if ((itpsByStatus.client_accepted ?? 0) < totalItps) {
    phase = {
      label: "Nearing completion",
      tone: "info",
      body: "No open NCRs or punch items right now, but not every ITP has reached Client Accepted yet.",
      nextAction: "Follow up on outstanding client acceptances",
      nextHref: "/inspect/itps",
    };
  } else {
    phase = {
      label: "Ready for handover",
      tone: "success",
      body: "Every ITP is client-accepted and there are no open NCRs or punch items — this project is ready to compile and issue its Data Book.",
      nextAction: "Compile the Data Book",
      nextHref: `/inspect/projects/${projectId}/data-book`,
    };
  }

  const PHASE_TONE_CLASS: Record<Phase["tone"], string> = {
    neutral: "border-border bg-off-white text-ink",
    warning: "border-warning/40 bg-warning/10 text-warning",
    info: "border-info/40 bg-info/10 text-info",
    success: "border-success/40 bg-success/10 text-success",
    danger: "border-danger/40 bg-danger/10 text-danger",
  };

  const Heading = embedded ? "h2" : "h1";
  return (
    <div className={embedded ? "" : "max-w-4xl"}>
      {!embedded && (
        <Link href={`/inspect/projects/${projectId}`} className="text-sm text-burgundy hover:underline">
          ← Back to Project
        </Link>
      )}

      <div className="mt-3 rounded-xl border border-border bg-gradient-to-br from-burgundy/5 to-transparent p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-burgundy">Project Guide</p>
        <Heading className="mt-1 text-2xl font-semibold text-ink">
          {project.project_number} <span className="font-normal text-muted">— {project.name}</span>
        </Heading>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Who&apos;s on this project, what&apos;s actually expected of them, and where the pipeline stands right now — for &quot;is
          this project done yet, as a %,&quot; see the Data Book instead; this page is the people/roles map.
        </p>
      </div>

      <section className={`mt-4 rounded-lg border p-4 ${PHASE_TONE_CLASS[phase.tone]}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Current phase: {phase.label}</h2>
          {phase.nextAction && (
            <Link href={phase.nextHref} className="rounded-md border border-current px-2.5 py-1 text-xs font-medium hover:bg-white/40">
              {phase.nextAction} →
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm">{phase.body}</p>
      </section>

      {isMyProjectRole && (
        <section className="mt-6 rounded-lg border border-burgundy/40 bg-burgundy/5 p-4">
          <h2 className="text-sm font-semibold text-burgundy">
            Your role here: {PARTY_TYPE_LABEL[myParty!.party_type] ?? myParty!.party_type}
          </h2>
          <p className="mt-2 text-sm text-ink">
            {PARTY_TYPE_RESPONSIBILITY[myParty!.party_type] ?? "See the App Guide for general role responsibilities."}
          </p>
          <p className="mt-2 text-xs text-muted">
            On the intervention grid, you can only sign off the &quot;{myParty!.name}&quot; column — every other party&apos;s pending
            cell will show &quot;Awaiting party&quot; instead of a Sign off button for you.
          </p>
        </section>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Project basics</h2>
          <dl className="mt-2 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Client organisation</dt>
              <dd className="text-right text-ink">{project.organizations?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Status</dt>
              <dd className="text-right text-ink">{project.status}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Site location</dt>
              <dd className="text-right text-ink">{project.site_location ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Contract number</dt>
              <dd className="text-right text-ink">{project.contract_number ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">What&apos;s actually required here</h2>
          <p className="mt-1 text-xs text-muted">
            No single &quot;requirements&quot; field exists — the real requirements live in each ITP&apos;s applicable standard and
            the Document Vault.
          </p>
          {standards.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {standards.map((s) => (
                <span key={s} className="rounded-full border border-border bg-off-white px-2 py-0.5 text-xs text-ink">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No ITPs with an applicable standard set yet.</p>
          )}
          <div className="mt-3 flex gap-3 text-sm">
            <Link href="/inspect/vault" className="font-medium text-burgundy hover:underline">
              Document Vault →
            </Link>
            <Link href="/inspect/itps" className="font-medium text-burgundy hover:underline">
              ITP Register →
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">Reports &amp; documents</h2>
        <p className="mt-1 text-sm text-muted">
          Data books, PDF/Excel report packs, and the live activity timeline for this project.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href={`/inspect/projects/${projectId}/reports`} className="font-medium text-burgundy hover:underline">
            Reports &amp; downloads →
          </Link>
          <Link href={`/inspect/projects/${projectId}/data-book`} className="font-medium text-burgundy hover:underline">
            Data book →
          </Link>
          <Link href={`/inspect/projects/${projectId}/activity`} className="font-medium text-burgundy hover:underline">
            Activity →
          </Link>
          <Link href={`/inspect/projects/${projectId}/kpis`} className="font-medium text-burgundy hover:underline">
            KPIs →
          </Link>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Everyone on this project</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(parties ?? []).map((p) => (
            <div key={p.id} className="flex items-start gap-3 rounded-md border border-border bg-off-white p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-xs font-semibold text-burgundy">
                {initialsOf(p.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                  <Badge tone={PARTY_TYPE_TONE[p.party_type] ?? "neutral"}>{PARTY_TYPE_LABEL[p.party_type] ?? p.party_type}</Badge>
                  {p.user_id === session.userId && <Badge tone="gold">You</Badge>}
                  {!p.is_active && <Badge tone="neutral">Inactive</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted">{PARTY_TYPE_RESPONSIBILITY[p.party_type] ?? ""}</p>
              </div>
            </div>
          ))}
          {(parties ?? []).length === 0 && <p className="text-sm text-muted">No parties added to this project yet.</p>}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Where the pipeline actually stands</h2>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-muted">ITPs ({(itps ?? []).length})</p>
            <div className="mt-1.5">
              <PipelineBar segments={itpSegments} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">NCRs ({(ncrs ?? []).length})</p>
            <div className="mt-1.5">
              <PipelineBar segments={ncrSegments} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted">Punch list ({(openPunchCount ?? 0) + (closedPunchCount ?? 0)})</p>
            <div className="mt-1.5">
              <PipelineBar segments={punchSegments} />
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted">
          See the{" "}
          <Link href={`/inspect/projects/${projectId}/punch-list`} className="font-medium text-burgundy hover:underline">
            Punch List →
          </Link>{" "}
          for individual items, or the{" "}
          <Link href={`/inspect/projects/${projectId}/data-book`} className="font-medium text-burgundy hover:underline">
            Data Book →
          </Link>{" "}
          for the overall readiness score.
        </p>
      </section>
    </div>
  );
}
