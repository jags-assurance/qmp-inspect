import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type ActivitySignoffProgressRow } from "@/lib/signoff/db-types";
import { CHECKLIST_TEMPLATES_TABLE, type ChecklistTemplateRow } from "@/lib/checklists/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { ACTIVITY_EXPECTED_RECORDS_TABLE, type ActivityExpectedRecordRow } from "@/lib/expected-records/db-types";
import { ITP_ITEM_MEASUREMENTS_TABLE, ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE, type ItpItemMeasurementRow } from "@/lib/itps/evidence-actions";
import type { InterventionLevel } from "@jags/shared-types";
import { PageGuide } from "@/components/domain/page-guide";

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
 * All three evidence types now have a real completion signal (see lib/itps/evidence-actions.ts for
 * the document-upload/measurement mechanisms this page reads from):
 *   evidence_type=1 (Checklist): a checklist_templates row + an inspection_records overall_result.
 *   evidence_type=2 (Document upload): at least one linked itp_item_evidence_documents row.
 *   evidence_type=3 (Measurement record): every itp_item_measurements row has a result, none failed.
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
      "id, section_number, title, itp_items(id, item_number, activity, acceptance_criteria, method, frequency, evidence_type, sort_order, discipline_id, master_disciplines(code))"
    )
    .eq("itp_id", id)
    .order("section_number")
    .returns<
      {
        id: string;
        section_number: number;
        title: string;
        itp_items: {
          id: string;
          item_number: string;
          activity: string;
          acceptance_criteria: string | null;
          method: string | null;
          frequency: string | null;
          evidence_type: 1 | 2 | 3;
          sort_order: number;
          discipline_id: string | null;
          master_disciplines: { code: string } | null;
        }[];
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

  const { data: expectedRecords } =
    itemIds.length > 0
      ? await supabase
          .from(ACTIVITY_EXPECTED_RECORDS_TABLE)
          .select("id, itp_item_id, provider, record_type, received_at")
          .in("itp_item_id", itemIds)
          .returns<Pick<ActivityExpectedRecordRow, "id" | "itp_item_id" | "provider" | "record_type" | "received_at">[]>()
      : { data: [] as Pick<ActivityExpectedRecordRow, "id" | "itp_item_id" | "provider" | "record_type" | "received_at">[] };

  const expectedRecordsByItem = (expectedRecords ?? []).reduce<Map<string, typeof expectedRecords>>((map, row) => {
    const list = map.get(row.itp_item_id) ?? [];
    list.push(row);
    map.set(row.itp_item_id, list);
    return map;
  }, new Map());

  const [{ data: measurements }, { data: evidenceDocuments }] =
    itemIds.length > 0
      ? await Promise.all([
          supabase
            .from(ITP_ITEM_MEASUREMENTS_TABLE)
            .select("itp_item_id, result")
            .in("itp_item_id", itemIds)
            .returns<Pick<ItpItemMeasurementRow, "itp_item_id" | "result">[]>(),
          supabase
            .from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE)
            .select("itp_item_id")
            .in("itp_item_id", itemIds)
            .returns<{ itp_item_id: string }[]>(),
        ])
      : [{ data: [] as Pick<ItpItemMeasurementRow, "itp_item_id" | "result">[] }, { data: [] as { itp_item_id: string }[] }];

  const measurementsByItem = (measurements ?? []).reduce<Map<string, Pick<ItpItemMeasurementRow, "itp_item_id" | "result">[]>>(
    (map, row) => {
      const list = map.get(row.itp_item_id) ?? [];
      list.push(row);
      map.set(row.itp_item_id, list);
      return map;
    },
    new Map()
  );
  const evidenceDocumentCountByItem = (evidenceDocuments ?? []).reduce<Map<string, number>>((map, row) => {
    map.set(row.itp_item_id, (map.get(row.itp_item_id) ?? 0) + 1);
    return map;
  }, new Map());

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
    if (item.evidence_type === 2) {
      // See lib/itps/evidence-actions.ts's linkItpItemEvidenceDocumentAction — existence of at
      // least one linked vault document IS the completion signal for this evidence type; there's
      // no pass/fail concept for "is this the right document," only "has one been provided."
      const count = evidenceDocumentCountByItem.get(item.id) ?? 0;
      return count > 0
        ? { label: `${count} document${count === 1 ? "" : "s"} linked`, tone: "success", done: true }
        : { label: "No evidence yet", tone: "neutral", done: false };
    }
    if (item.evidence_type === 3) {
      const rows = measurementsByItem.get(item.id) ?? [];
      if (rows.length === 0) return { label: "Not started", tone: "neutral", done: false };
      const recorded = rows.filter((r) => r.result != null);
      if (recorded.length < rows.length) return { label: "In progress", tone: "warning", done: false };
      const anyFail = rows.some((r) => r.result === "fail");
      return anyFail
        ? { label: "Fail", tone: "danger", done: false }
        : { label: "Pass", tone: "success", done: true };
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
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink">
            Completion roadmap <span className="doc-id text-lg text-muted">{itp.itp_number}</span>
          </h1>
          <PageGuide
            title="Completion roadmap — how this works"
            points={[
              "Read-only summary of where every activity actually stands — combines evidence completion (checklist result, linked document, or measurement results) with H/W/R/S sign-off completion in one place, across all evidence types.",
              "An activity is only \"Complete\" once its evidence is done AND every required sign-off is given — a still-open blocking level (e.g. Hold) shows as \"Blocked\" even if the evidence itself has passed.",
              "This page only links out to where each thing is actually done — checklists open on their own fill page, evidence documents/measurements are recorded on the ITP page itself — nothing is editable here.",
              "\"Expected records\" (third-party test records like calibration certs) are tracked separately as received/not-yet-received and shown per activity when any are expected.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">{itp.title}</p>
      </div>

      <p className="mt-4 rounded-md border border-info/60 bg-info/10 px-3 py-2 text-xs text-info">
        Document-upload activities are done once at least one evidence document is linked;
        Measurement-record activities are done once every recorded measurement has a result and none
        have failed. Both are recorded per-activity on the ITP page itself (&ldquo;Manage evidence
        →&rdquo; below) — this page only summarises where each activity stands.
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

          // required === 0 is a legitimate state (no sign-off rows configured for this activity at
          // all) — "0 required, 0 done" should read as "nothing outstanding," not "can never be
          // complete." Found in a self-review audit: the old `required > 0` guard meant a fully-
          // passed activity with zero configured sign-off could never show Complete, with no
          // explanation given for why. `signedOff === required` alone already handles the 0-row case
          // correctly (0 === 0), so the guard was only ever excluding it, never protecting anything.
          const overallDone = evidence.done && signedOff === required;
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

          const expected = expectedRecordsByItem.get(item.id) ?? [];
          const expectedReceived = expected.filter((r) => r.received_at != null).length;
          const template = templateByItem.get(item.id);
          const missing: string[] = [];
          if (!evidence.done) {
            missing.push(
              item.evidence_type === 1
                ? evidence.label === "Checklist not generated"
                  ? "checklist hasn't been generated yet"
                  : evidence.label === "Not started"
                    ? "field inspection hasn't been run yet"
                    : evidence.label === "In progress"
                      ? "field inspection started but not completed"
                      : "last inspection did not pass"
                : item.evidence_type === 2
                  ? "no evidence document linked yet"
                  : evidence.label === "Not started"
                    ? "no measurements recorded yet"
                    : evidence.label === "In progress"
                      ? "not every measurement has a result yet"
                      : "a measurement failed"
            );
          }
          if (blockingOpen.length > 0) missing.push(`${blockingOpen.length} open Hold${blockingOpen.length === 1 ? "" : "s"}`);
          else if (required - signedOff > 0) missing.push(`${required - signedOff} sign-off${required - signedOff === 1 ? "" : "s"} still pending`);
          if (expected.length > 0 && expectedReceived < expected.length) {
            missing.push(`${expected.length - expectedReceived} expected record${expected.length - expectedReceived === 1 ? "" : "s"} not yet received`);
          }

          return (
            <div key={item.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-ink">
                    <span className="doc-id mr-1.5 text-muted">{item.item_number}</span>
                    {item.activity}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {item.sectionTitle}
                    {item.master_disciplines?.code && ` · ${item.master_disciplines.code}`}
                  </p>
                </div>
                <Badge tone={overallTone}>{overallLabel}</Badge>
              </div>

              {item.acceptance_criteria && (
                <p className="mt-2 text-xs text-muted">
                  <span className="font-medium text-ink">Acceptance criteria: </span>
                  {item.acceptance_criteria}
                </p>
              )}
              {(item.method || item.frequency) && (
                <p className="mt-1 text-xs text-muted">
                  {item.method && (
                    <>
                      <span className="font-medium text-ink">Method: </span>
                      {item.method}
                    </>
                  )}
                  {item.method && item.frequency && " · "}
                  {item.frequency && (
                    <>
                      <span className="font-medium text-ink">Frequency: </span>
                      {item.frequency}
                    </>
                  )}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-4 text-xs">
                <div>
                  <span className="text-muted">Evidence ({EVIDENCE_LABEL[item.evidence_type]}): </span>
                  <Badge tone={evidence.tone}>{evidence.label}</Badge>
                  {template ? (
                    <Link href={`/inspect/checklists/${template.id}`} className="ml-2 font-medium text-burgundy hover:underline">
                      {evidence.label === "Not started" ? "Start inspection →" : "Open checklist →"}
                    </Link>
                  ) : item.evidence_type === 1 ? (
                    // Previously a dead end: "Checklist not generated" with no way forward from
                    // this page — the only place to actually generate one is the ITP's own
                    // Checklists sub-page (generateChecklistTemplatesAction, staff-only, once the
                    // ITP is approved). Points there instead of leaving it unclickable.
                    <Link href={`/inspect/itps/${itp.id}/checklists`} className="ml-2 font-medium text-burgundy hover:underline">
                      Generate checklist →
                    </Link>
                  ) : (
                    // evidence_type 2/3: recording measurements or linking evidence documents
                    // happens per-activity on the ITP detail page itself (see
                    // ItpItemMeasurementsSection/ItpItemEvidenceDocumentsSection there), not on
                    // this roadmap page — same "roadmap links out, doesn't duplicate the form"
                    // pattern the Checklist link above already follows.
                    <Link href={`/inspect/itps/${itp.id}`} className="ml-2 font-medium text-burgundy hover:underline">
                      Manage evidence →
                    </Link>
                  )}
                </div>
                <div>
                  <span className="text-muted">Sign-off: </span>
                  <span className="font-medium text-ink">
                    {signedOff} of {required} complete
                  </span>
                </div>
                {expected.length > 0 && (
                  <div>
                    <span className="text-muted">Expected records: </span>
                    <span className="font-medium text-ink">
                      {expectedReceived} of {expected.length} received
                    </span>
                  </div>
                )}
              </div>

              {pendingParties.length > 0 && (
                <p className="mt-2 text-xs text-muted">
                  Waiting on:{" "}
                  {pendingParties
                    .map((p) => `${p.name} (${p.level}${p.isBlocking ? ", blocking" : ""} — ${p.status})`)
                    .join("; ")}
                </p>
              )}

              {!overallDone && missing.length > 0 && (
                <p className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-xs text-warning">
                  <span className="font-medium">Still needed: </span>
                  {missing.join("; ")}.
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
