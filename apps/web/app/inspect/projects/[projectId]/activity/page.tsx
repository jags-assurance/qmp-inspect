import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE } from "@/lib/signoff/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { STANDALONE_ASSIGNMENTS } from "@/lib/standalone/types";
import { DATA_BOOKS_TABLE, HANDOVER_CERTIFICATES_TABLE } from "@/lib/databook/types";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { VAULT_FOLDERS_TABLE, VAULT_DOCUMENTS_TABLE } from "@/lib/vault/types";
import { PageGuide } from "@/components/domain/page-guide";

const EVENT_DOT_TONE: Record<ActivityEvent["kind"], string> = {
  itp_created: "bg-info",
  itp_reviewed: "bg-info",
  itp_approved: "bg-gold",
  itp_client_accepted: "bg-gold",
  inspection: "bg-emerald-600",
  ncr_raised: "bg-burgundy",
  ncr_closed: "bg-gold",
  signoff_notified: "bg-info",
  signoff_signed_off: "bg-ink",
  signoff_proceeded: "bg-warning",
  standalone_completed: "bg-emerald-600",
  databook_compiled: "bg-gold",
  handover_issued: "bg-gold",
  handover_acknowledged: "bg-gold",
  punch_opened: "bg-burgundy",
  punch_closed: "bg-gold",
  vault_uploaded: "bg-info",
};

interface ActivityEvent {
  id: string;
  kind:
    | "itp_created"
    | "itp_reviewed"
    | "itp_approved"
    | "itp_client_accepted"
    | "inspection"
    | "ncr_raised"
    | "ncr_closed"
    | "signoff_notified"
    | "signoff_signed_off"
    | "signoff_proceeded"
    | "standalone_completed"
    | "databook_compiled"
    | "handover_issued"
    | "handover_acknowledged"
    | "punch_opened"
    | "punch_closed"
    | "vault_uploaded";
  timestamp: string;
  description: string;
}

/**
 * Unified, chronological "what's happened on this project" feed. Every event kind here is backed by
 * a real, already-recorded timestamp column — nothing is inferred or fabricated from an unrelated
 * column (e.g. updated_at). Reachable by any role with project access (client, subcontractor,
 * main_contractor, tpi_lab, staff) — no staff-only gate, same as punch-list/kpis.
 *
 * itps.reviewed_at/approved_at, standalone_assignments.completed_at and
 * activity_signoff_progress.proceeded_at (supabase/migrations/20260918030000_activity_log_timestamps.sql)
 * were added specifically to close the gap this feed's own earlier doc comment called out: those
 * three transitions had a "who" (reviewed_by/approved_by) recorded but no "when," so they used to be
 * omitted entirely rather than guessed at. Every other event kind below (ITP created/client-accepted,
 * sign-off notified, data book compiled, handover issued/acknowledged, punch list opened/closed,
 * vault document uploaded) already had a real timestamp on record and simply wasn't being surfaced.
 */
export default async function ProjectActivityPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, organization_id, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{
      id: string;
      project_number: string;
      name: string;
      organization_id: string;
      organizations: { name: string } | null;
    }>();

  if (!project) notFound();

  const { data: levelTypes } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .select("code, label")
    .eq("organization_id", project.organization_id)
    .returns<{ code: string; label: string }[]>();
  const levelLabelByCode = new Map((levelTypes ?? []).map((l) => [l.code, l.label]));

  const [
    { data: inspections },
    { data: ncrs },
    { data: itps },
    { data: standaloneAssignments },
    { data: dataBooks },
    { data: punchItems },
    { data: vaultFolders },
  ] = await Promise.all([
    supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("id, record_number, overall_result, created_at")
      .eq("project_id", projectId)
      .not("overall_result", "is", null)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<{ id: string; record_number: string; overall_result: string; created_at: string }[]>(),
    supabase
      .from(NCRS_TABLE)
      .select("id, ncr_number, created_at, closed_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<{ id: string; ncr_number: string; created_at: string; closed_at: string | null }[]>(),
    supabase
      .from("itps")
      .select("id, itp_number, title, created_at, reviewed_at, approved_at, client_accepted_at")
      .eq("project_id", projectId)
      .returns<
        {
          id: string;
          itp_number: string;
          title: string;
          created_at: string;
          reviewed_at: string | null;
          approved_at: string | null;
          client_accepted_at: string | null;
        }[]
      >(),
    supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("id, assignment_number, equipment_description, conclusion, completed_at")
      .eq("project_id", projectId)
      .not("completed_at", "is", null)
      .returns<{ id: string; assignment_number: string; equipment_description: string; conclusion: string | null; completed_at: string }[]>(),
    supabase
      .from(DATA_BOOKS_TABLE)
      .select("id, book_number, compiled_at")
      .eq("project_id", projectId)
      .not("compiled_at", "is", null)
      .returns<{ id: string; book_number: string; compiled_at: string }[]>(),
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, description, created_at, closed_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<{ id: string; description: string; created_at: string; closed_at: string | null }[]>(),
    supabase.from(VAULT_FOLDERS_TABLE).select("id").eq("project_id", projectId).returns<{ id: string }[]>(),
  ]);

  const itpIds = (itps ?? []).map((itp) => itp.id);

  const signoffEvents: ActivityEvent[] = [];
  if (itpIds.length > 0) {
    const { data: sections } = await supabase
      .from("itp_sections")
      .select("id")
      .in("itp_id", itpIds)
      .returns<{ id: string }[]>();
    const sectionIds = (sections ?? []).map((s) => s.id);

    if (sectionIds.length > 0) {
      const { data: items } = await supabase
        .from("itp_items")
        .select("id, activity")
        .in("section_id", sectionIds)
        .returns<{ id: string; activity: string }[]>();
      const activityByItemId = new Map((items ?? []).map((i) => [i.id, i.activity]));
      const itemIds = [...activityByItemId.keys()];

      if (itemIds.length > 0) {
        const { data: signoffs } = await supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("id, itp_item_id, project_party_id, intervention, status, notified_at, signed_off_at, proceeded_at")
          .in("itp_item_id", itemIds)
          .in("status", ["notified", "signed_off", "proceeded_no_response"])
          .limit(100)
          .returns<
            {
              id: string;
              itp_item_id: string;
              project_party_id: string;
              intervention: string;
              status: string;
              notified_at: string | null;
              signed_off_at: string | null;
              proceeded_at: string | null;
            }[]
          >();
        const rows = signoffs ?? [];

        const partyIds = [...new Set(rows.map((r) => r.project_party_id))];
        const { data: parties } =
          partyIds.length > 0
            ? await supabase
                .from("project_parties")
                .select("id, name")
                .in("id", partyIds)
                .returns<{ id: string; name: string }[]>()
            : { data: [] as { id: string; name: string }[] };
        const partyNameById = new Map((parties ?? []).map((p) => [p.id, p.name]));

        for (const row of rows) {
          const levelLabel = levelLabelByCode.get(row.intervention) ?? row.intervention;
          const partyName = partyNameById.get(row.project_party_id) ?? "Unknown party";
          const activity = activityByItemId.get(row.itp_item_id) ?? "an activity";

          // A row that's since progressed to signed_off/proceeded still has its earlier notified_at
          // set — surfaced as its own distinct event rather than only the row's current end state.
          if (row.notified_at) {
            signoffEvents.push({
              id: `signoff-notified-${row.id}`,
              kind: "signoff_notified",
              timestamp: row.notified_at,
              description: `${partyName} notified of ${levelLabel} on ${activity}`,
            });
          }
          if (row.signed_off_at) {
            signoffEvents.push({
              id: `signoff-signedoff-${row.id}`,
              kind: "signoff_signed_off",
              timestamp: row.signed_off_at,
              description: `${levelLabel} sign-off recorded by ${partyName} on ${activity}`,
            });
          }
          if (row.proceeded_at) {
            signoffEvents.push({
              id: `signoff-proceeded-${row.id}`,
              kind: "signoff_proceeded",
              timestamp: row.proceeded_at,
              description: `${levelLabel} on ${activity} proceeded without a response from ${partyName}`,
            });
          }
        }
      }
    }
  }

  let vaultEvents: ActivityEvent[] = [];
  const folderIds = (vaultFolders ?? []).map((f) => f.id);
  if (folderIds.length > 0) {
    const { data: documents } = await supabase
      .from(VAULT_DOCUMENTS_TABLE)
      .select("id, title, document_number, created_at")
      .in("folder_id", folderIds)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<{ id: string; title: string; document_number: string | null; created_at: string }[]>();

    vaultEvents = (documents ?? []).map((doc) => ({
      id: `vault-${doc.id}`,
      kind: "vault_uploaded" as const,
      timestamp: doc.created_at,
      description: `${doc.document_number ? `${doc.document_number} — ` : ""}${doc.title} uploaded to Document Vault`,
    }));
  }

  const handoverEvents: ActivityEvent[] = [];
  const dataBookIds = (dataBooks ?? []).map((b) => b.id);
  if (dataBookIds.length > 0) {
    const { data: certificates } = await supabase
      .from(HANDOVER_CERTIFICATES_TABLE)
      .select("id, certificate_number, created_at, acknowledged_at")
      .in("data_book_id", dataBookIds)
      .returns<{ id: string; certificate_number: string; created_at: string; acknowledged_at: string | null }[]>();

    for (const cert of certificates ?? []) {
      handoverEvents.push({
        id: `handover-issued-${cert.id}`,
        kind: "handover_issued",
        timestamp: cert.created_at,
        description: `Handover certificate ${cert.certificate_number} issued`,
      });
      if (cert.acknowledged_at) {
        handoverEvents.push({
          id: `handover-ack-${cert.id}`,
          kind: "handover_acknowledged",
          timestamp: cert.acknowledged_at,
          description: `Handover certificate ${cert.certificate_number} acknowledged`,
        });
      }
    }
  }

  const itpEvents: ActivityEvent[] = (itps ?? []).flatMap((itp) => {
    const events: ActivityEvent[] = [
      {
        id: `itp-created-${itp.id}`,
        kind: "itp_created",
        timestamp: itp.created_at,
        description: `${itp.itp_number} — ${itp.title} created`,
      },
    ];
    if (itp.reviewed_at) {
      events.push({
        id: `itp-reviewed-${itp.id}`,
        kind: "itp_reviewed",
        timestamp: itp.reviewed_at,
        description: `${itp.itp_number} moved to review`,
      });
    }
    if (itp.approved_at) {
      events.push({
        id: `itp-approved-${itp.id}`,
        kind: "itp_approved",
        timestamp: itp.approved_at,
        description: `${itp.itp_number} approved`,
      });
    }
    if (itp.client_accepted_at) {
      events.push({
        id: `itp-accepted-${itp.id}`,
        kind: "itp_client_accepted",
        timestamp: itp.client_accepted_at,
        description: `${itp.itp_number} accepted by the client`,
      });
    }
    return events;
  });

  const inspectionEvents: ActivityEvent[] = (inspections ?? []).map((record) => ({
    id: `insp-${record.id}`,
    kind: "inspection",
    timestamp: record.created_at,
    description: `${record.record_number} inspection completed — ${record.overall_result}`,
  }));

  const ncrEvents: ActivityEvent[] = (ncrs ?? []).flatMap((ncr) => {
    const events: ActivityEvent[] = [
      {
        id: `ncr-raised-${ncr.id}`,
        kind: "ncr_raised",
        timestamp: ncr.created_at,
        description: `${ncr.ncr_number} raised`,
      },
    ];
    if (ncr.closed_at) {
      events.push({
        id: `ncr-closed-${ncr.id}`,
        kind: "ncr_closed",
        timestamp: ncr.closed_at,
        description: `${ncr.ncr_number} closed`,
      });
    }
    return events;
  });

  const standaloneEvents: ActivityEvent[] = (standaloneAssignments ?? []).map((a) => ({
    id: `standalone-${a.id}`,
    kind: "standalone_completed",
    timestamp: a.completed_at,
    description: `${a.assignment_number} — ${a.equipment_description} completed${a.conclusion ? ` (${a.conclusion.replace("_", " ")})` : ""}`,
  }));

  const databookEvents: ActivityEvent[] = (dataBooks ?? []).map((b) => ({
    id: `databook-${b.id}`,
    kind: "databook_compiled",
    timestamp: b.compiled_at,
    description: `Data book ${b.book_number} compiled`,
  }));

  const punchEvents: ActivityEvent[] = (punchItems ?? []).flatMap((p) => {
    const events: ActivityEvent[] = [
      {
        id: `punch-opened-${p.id}`,
        kind: "punch_opened",
        timestamp: p.created_at,
        description: `Punch item opened — ${p.description}`,
      },
    ];
    if (p.closed_at) {
      events.push({
        id: `punch-closed-${p.id}`,
        kind: "punch_closed",
        timestamp: p.closed_at,
        description: `Punch item closed — ${p.description}`,
      });
    }
    return events;
  });

  const events = [
    ...itpEvents,
    ...inspectionEvents,
    ...ncrEvents,
    ...signoffEvents,
    ...standaloneEvents,
    ...databookEvents,
    ...handoverEvents,
    ...punchEvents,
    ...vaultEvents,
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 80);

  return (
    <div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="doc-id text-2xl font-semibold text-ink">{project.project_number} — Activity</h1>
          <PageGuide
            title="Activity — how this works"
            points={[
              "A single chronological feed of everything recorded on this project — ITP lifecycle, sign-offs, inspections, NCRs, standalone assignments, data book/handover, punch list, and Document Vault uploads.",
              "Reachable by any role with access to this project (client, subcontractor, main contractor, TPI/lab, staff) — no staff-only gate, same as Punch List and Client KPIs.",
              "Every event shown is backed by a real recorded timestamp column — nothing here is inferred or backfilled from an unrelated column like updated_at.",
              "Capped to the most recent 80 events across all sources, newest first.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name} · {project.name}. A full chronological feed of everything recorded on this
          project — ITPs, sign-offs, inspections, NCRs, standalone assignments, data book and handover, punch list,
          and Document Vault uploads.
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        {events.length === 0 ? (
          <p className="text-sm text-muted">No activity recorded on this project yet.</p>
        ) : (
          <ol className="space-y-4">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${EVENT_DOT_TONE[event.kind]}`} />
                <div>
                  <p className="text-sm text-ink">{event.description}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {new Date(event.timestamp).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
