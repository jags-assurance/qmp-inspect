import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type ActivitySignoffProgressRow } from "@/lib/signoff/db-types";
import { CHECKLIST_TEMPLATES_TABLE, type ChecklistTemplateRow } from "@/lib/checklists/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import type { InterventionLevel } from "@jags/shared-types";

const EVIDENCE_LABEL: Record<1 | 2 | 3, string> = {
  1: "Checklist",
  2: "Document upload",
  3: "Measurement record",
};

/**
 * Answers "how much of this ITP is actually done, what's left, and who's blocking it" in one place
 * — found live this session that no such view existed: the main ITP page's sign-off counter only
 * covers the H/W/R/S grid, and the Checklists sub-page only covers evidence for Checklist-type
 * items. This combines both, per activity, across every item on the ITP.
 *
 * Deliberately honest about a real product gap found while building this: only evidence_type = 1
 * (Checklist) items have any real field-execution mechanism today (a generated checklist_templates
 * row + inspection_records). Document-upload and Measurement-record items (evidence_type 2/3) are
 * currently just a label on the grid — nothing in the app records that evidence yet — so this shows
 * that plainly rather than fabricating a fake "complete"/"pending" for something never tracked.
 */
export default async function ItpStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: itp } = await supabase
    .from("itps")
    .select("id, itp_number, title, status, project_id, projects(name)")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      itp_number: string;
      title: string;
      status: string;
      project_id: string;
      projects: { name: string } | null;
    }>();

  if (!itp) notFound();

  const { data: sections } = await supabase
    .from("itp_sections")
    .select(
      "id, section_number, title, itp_items(id, item_number, activity, evidence_type, sort_order)"
    )
    .eq("itp_id", id)
    .order("section_number")
    .returns<
      {
        id: string;
        section_number: number;
        title: string;
        itp_items: { id: string; item_number: string; activity: string; evidence_type: 1 | 2 | 3; sort_order: number }[];
      }[]
    >();

  const items = (sections ?? [])
    .flatMap((s) => (s.itp_items ?? []).map((it) => ({ ...it, sectionTitle: s.title })))
    .sort((a, b) => a.item_number.localeCompare(b.item_number, undefined, { numeric: true }));
  const itemIds = items.map((it) => it.id);
  const checklistItemIds = items.filter((it) => it.evidence_type === 1).map((it) => it.id);

  const [
    { data: templates },
    { data: interventions },
    { data: signoffs },
    { data: parties },
    { data: levelTypes },
  ] = await Promise.all([
    checklistItemIds.length > 0
      ? supabase
          .from(CHECKLIST_TEMPLATES_TABLE)
          .select("id, itp_item_id, checklist_number")
          .in("itp_item_id", checklistItemIds)
          .returns<Pick<ChecklistTemplateRow, "id" | "itp_item_id" | "checklist_number">[]>()
      : Promise.resolve({ data: [] as Pick<ChecklistTemplateRow, "id" | "itp_item_id" | "checklist_number">[] }),
    itemIds.length > 0
      ? supabase
          .from("activity_party_intervention")
          .select("itp_item_id, project_party_id, intervention")
          .in("itp_item_id", itemIds)
          .returns<{ itp_item_id: string; project_party_id: string; intervention: InterventionLevel }[]>()
      : Promise.resolve({ data: [] as { itp_item_id: string; project_party_id: string; intervention: InterventionLevel }[] }),
    itemIds.length > 0
      ? supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("id, itp_item_id, project_party_id, intervention, status, notified_at")
          .in("itp_item_id", itemIds)
          .returns<
            Pick<ActivitySignoffProgressRow, "id" | "itp_item_id" | "project_party_id" | "intervention" | "status" | "notified_at">[]
          >()
      : Promise.resolve({
          data: [] as Pick<
            ActivitySignoffProgressRow,
            "id" | "itp_item_id" | "project_party_id" | "intervention" | "status" | "notified_at"
          >[],
        }),
    supabase.from("project_parties").select("id, name").eq("project_id", itp.project_id).returns<{ id: string; name: string }[]>(),
    supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("code, label, is_blocking")
      .returns<{ code: string; label: string; is_blocking: boolean }[]>(),
  ]);

  const templateByItem = new Map((templates ?? []).map((t) => [t.itp_item_id, t]));
  const templateIds = (templates ?? []).map((t) => t.id);

  const { data: inspectionRecords } =
    templateIds.length > 0
      ? await supabase
          .from("inspection_records")
          .select("checklist_template_id, overall_result, created_at")
          .in("checklist_template_id", templateIds)
          .order("created_at", { ascending: false })
          .returns<{ checklist_template_id: string | null; overall_result: string | null; created_at: string }[]>()
      : { data: [] as { checklist_template_id: string | null; overall_result: string | null; created_at: string }[] };

  const latestResultByTemplateId = new Map<string, string | null>();
  for (const row of inspectionRecords ?? []) {
    if (row.checklist_template_id && !latestResultByTemplateId.has(row.checklist_template_id)) {
      latestResultByTemplateId.set(row.checklist_template_id, row.overall_result);
    }
  }

  const partyNameById = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const levelByCode = new Map((levelTypes ?? []).map((l) => [l.code, l]));

  const EVIDENCE_RESULT_LABEL: Record<string, { label: string; tone: "success" | "danger" | "warning" }> = {
    pass: { label: "Pass", tone: "success" },
    fail: { label: "Fail", tone: "danger" },
    partial: { label: "Partial", tone: "warning" },
  };

  function evidenceStatusFor(item: (typeof items)[number]): { label: string; tone: "success" | "danger" | "warning" | "neutral"; done: boolean } {
    if (item.evidence_type !== 1) {
      return { label: "No execution flow yet", tone: "neutral", done: false };
    }
    const template = templateByItem.get(item.id);
    if (!template) return { label: "Checklist not generated", tone: "neutral", done: false };
    if (!latestResultByTemplateId.has(template.id)) return { label: "Not started", tone: "neutral", done: false };
    const result = latestResultByTemplateId.get(template.id);
    if (result && EVIDENCE_RESULT_LABEL[result]) {
      return { ...EVIDENCE_RESULT_LABEL[result], done: result === "pass" };
    }
    return { label: "In progress", tone: "warning", done: false };
  }

  const itemSignoffs = (signoffs ?? []).reduce<Map<string, typeof signoffs>>((map, row) => {
    const list = map.get(row.itp_item_id) ?? [];
    list.push(row);
    map.set(row.itp_item_id, list);
    return map;
  }, new Map());

  return (
    <div>
      <Link href={`/inspect/itps/${itp.id}`} className="text-sm text-burgundy hover:underline">
        ← Back to ITP
      </Link>
      <div className="mt-2">
        <p className="text-sm text-muted">{itp.projects?.name}</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          Completion roadmap <span className="doc-id text-lg text-muted">{itp.itp_number}</span>
        </h1>
        <p className="mt-1 text-sm text-muted">{itp.title}</p>
      </div>

      <p className="mt-4 rounded-md border border-info/60 bg-info/10 px-3 py-2 text-xs text-info">
        Only Checklist-type activities have a real field-execution flow today — Document-upload and
        Measurement-record activities show as "No execution flow yet" until that's built, rather than
        a fabricated status.
      </p>

      <div className="mt-6 space-y-3">
        {items.map((item) => {
          const evidence = evidenceStatusFor(item);
          const rows = itemSignoffs.get(item.id) ?? [];
          const required = rows.length;
          const signedOff = rows.filter((r) => r.status === "signed_off" || r.status === "proceeded_no_response").length;
          const blockingOpen = rows.filter((r) => {
            const level = levelByCode.get(r.intervention);
            return level?.is_blocking && r.status !== "signed_off" && r.status !== "proceeded_no_response";
          });
          const pendingParties = rows
            .filter((r) => r.status !== "signed_off" && r.status !== "proceeded_no_response")
            .map((r) => ({
              name: partyNameById.get(r.project_party_id) ?? "Unknown party",
              level: levelByCode.get(r.intervention)?.label ?? r.intervention,
              status: r.status,
              isBlocking: !!levelByCode.get(r.intervention)?.is_blocking,
            }));

          const overallDone = evidence.done && required > 0 && signedOff === required;
          const overallTone: "success" | "danger" | "warning" | "neutral" = overallDone
            ? "success"
            : blockingOpen.length > 0
              ? "danger"
              : "warning";
          const overallLabel = overallDone
            ? "Complete"
            : blockingOpen.length > 0
              ? "Blocked — open Hold"
              : "Pending";

          return (
            <div key={item.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-ink">
                    <span className="doc-id mr-1.5 text-muted">{item.item_number}</span>
                    {item.activity}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{item.sectionTitle}</p>
                </div>
                <Badge tone={overallTone}>{overallLabel}</Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs">
                <div>
                  <span className="text-muted">Evidence ({EVIDENCE_LABEL[item.evidence_type]}): </span>
                  <Badge tone={evidence.tone}>{evidence.label}</Badge>
                </div>
                <div>
                  <span className="text-muted">Sign-off: </span>
                  <span className="font-medium text-ink">
                    {signedOff} of {required} complete
                  </span>
                </div>
              </div>

              {pendingParties.length > 0 && (
                <p className="mt-2 text-xs text-muted">
                  Waiting on:{" "}
                  {pendingParties
                    .map((p) => `${p.name} (${p.level}${p.isBlocking ? ", blocking" : ""} — ${p.status})`)
                    .join("; ")}
                </p>
              )}
            </div>
          );
        })}
        {items.length === 0 && <p className="text-sm text-muted">This ITP has no activities yet.</p>}
      </div>
    </div>
  );
}
