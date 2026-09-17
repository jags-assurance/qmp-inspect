import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE } from "@/lib/signoff/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";

const EVENT_DOT_TONE: Record<ActivityEvent["kind"], string> = {
  inspection: "bg-emerald-600",
  ncr_raised: "bg-burgundy",
  ncr_closed: "bg-gold",
  signoff: "bg-ink",
};

interface ActivityEvent {
  id: string;
  kind: "inspection" | "ncr_raised" | "ncr_closed" | "signoff";
  timestamp: string;
  description: string;
}

/**
 * Unified, chronological "what's happened on this project" feed — inspections completed, NCRs
 * raised/closed, and activity sign-offs recorded, merged and sorted in application code (the
 * Supabase client has no clean SQL UNION). Reachable by any role with project access (client,
 * subcontractor, main_contractor, tpi_lab, staff) — no staff-only gate, same as punch-list/kpis.
 * ITP status changes are intentionally omitted: there's no audit_log table (or equivalent) backing
 * per-change history, and fabricating events from current-state columns would misrepresent history
 * that isn't actually recorded.
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

  const [{ data: inspections }, { data: ncrs }, { data: itps }] = await Promise.all([
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
    supabase.from("itps").select("id").eq("project_id", projectId).returns<{ id: string }[]>(),
  ]);

  const itpIds = (itps ?? []).map((itp) => itp.id);

  let signoffEvents: ActivityEvent[] = [];
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
          .select("id, itp_item_id, project_party_id, intervention, status, signed_off_at")
          .in("itp_item_id", itemIds)
          .eq("status", "signed_off")
          .not("signed_off_at", "is", null)
          .order("signed_off_at", { ascending: false })
          .limit(50)
          .returns<
            {
              id: string;
              itp_item_id: string;
              project_party_id: string;
              intervention: string;
              status: string;
              signed_off_at: string | null;
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

        signoffEvents = rows
          .filter((row) => row.signed_off_at)
          .map((row) => ({
            id: row.id,
            kind: "signoff" as const,
            timestamp: row.signed_off_at as string,
            description: `${levelLabelByCode.get(row.intervention) ?? row.intervention} sign-off recorded by ${
              partyNameById.get(row.project_party_id) ?? "Unknown party"
            } on ${activityByItemId.get(row.itp_item_id) ?? "an activity"}`,
          }));
      }
    }
  }

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

  const events = [...inspectionEvents, ...ncrEvents, ...signoffEvents]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 50);

  return (
    <div>
      <div>
        <h1 className="doc-id text-2xl font-semibold text-ink">{project.project_number} — Activity</h1>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name} · {project.name}. A chronological feed of inspections, NCRs and sign-offs on
          this project.
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
