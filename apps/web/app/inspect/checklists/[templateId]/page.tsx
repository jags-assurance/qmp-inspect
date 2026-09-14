import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import {
  CHECKLIST_ITEMS_TABLE,
  CHECKLIST_RESPONSES_TABLE,
  CHECKLIST_TEMPLATES_TABLE,
  INSPECTION_PHOTOS_TABLE,
  INSPECTION_RECORDS_TABLE,
  type ChecklistItemRow,
  type ChecklistResponseRow,
  type InspectionPhotoRow,
  type InspectionRecordRow,
} from "@/lib/checklists/db-types";
import { checkRegisterVerification, type RegisterVerificationResult } from "@/lib/registers/verify";
import { ResponseRow } from "./response-row";
import { AddChecklistItemForm } from "./add-checklist-item-form";
import { StartInspectionForm } from "./start-inspection-form";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PhotoUpload } from "./photo-upload";
import { CompleteInspectionForm } from "./complete-inspection-form";
import { ConsistencyCheck } from "./consistency-check";

/**
 * Field execution surface for one checklist: shows any in-progress inspection to keep filling in,
 * or a "Start inspection" prompt if there isn't one, plus the checklist's own item list (staff can
 * extend it here, matching the ITP add-item pattern).
 */
export default async function ChecklistFillPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: template } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select(
      "id, checklist_number, name, itp_items(id, item_number, activity, reference_spec, acceptance_criteria, itp_sections(itps(id, itp_number, projects(id, name, organizations(name)))))"
    )
    .eq("id", templateId)
    .maybeSingle<{
      id: string;
      checklist_number: string;
      name: string;
      itp_items: {
        id: string;
        item_number: string;
        activity: string;
        reference_spec: string | null;
        acceptance_criteria: string | null;
        itp_sections: {
          itps: {
            id: string;
            itp_number: string;
            projects: { id: string; name: string; organizations: { name: string } | null } | null;
          } | null;
        } | null;
      } | null;
    }>();

  if (!template) notFound();

  const itpItem = template.itp_items;
  const itp = itpItem?.itp_sections?.itps;
  const project = itp?.projects;
  if (!itpItem || !itp || !project) notFound();

  // R76: "the originator (typically the subcontractor/contractor) raises the inspection request" —
  // self-inspection is that party's own spec'd role, not JAGS staff's alone. A party is a legitimate
  // stakeholder on this specific activity when they hold an intervention level (H/W/R/S) on it; if
  // the current login is linked (via project_parties.user_id) to one of those parties, they can run
  // this checklist too. A client with no intervention on this activity still can't.
  const { data: stakeholderParties } = await supabase
    .from("activity_party_intervention")
    .select("project_parties(user_id)")
    .eq("itp_item_id", itpItem.id)
    .returns<{ project_parties: { user_id: string | null } | null }[]>();
  const isAssignedParty = (stakeholderParties ?? []).some((row) => row.project_parties?.user_id === session.userId);

  const { data: items } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("id, item_number, description, is_mandatory, sort_order")
    .eq("template_id", templateId)
    .order("sort_order")
    .returns<Pick<ChecklistItemRow, "id" | "item_number" | "description" | "is_mandatory" | "sort_order">[]>();

  const { data: draftRecords } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, location, inspection_date, created_at")
    .eq("checklist_template_id", templateId)
    .is("overall_result", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<Pick<InspectionRecordRow, "id" | "location" | "inspection_date" | "created_at">[]>();

  const draft = draftRecords?.[0] ?? null;

  const { data: pastRecords } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, record_number, overall_result, inspection_date")
    .eq("checklist_template_id", templateId)
    .not("overall_result", "is", null)
    .order("created_at", { ascending: false })
    .returns<Pick<InspectionRecordRow, "id" | "record_number" | "overall_result" | "inspection_date">[]>();

  let responseByItem = new Map<string, { result: "yes" | "no" | "na"; comment: string | null }>();
  let photos: { id: string; storage_path: string; caption: string | null }[] = [];
  let registerVerification: RegisterVerificationResult | null = null;

  if (draft) {
    const [{ data: responses }, { data: photoRows }] = await Promise.all([
      supabase
        .from(CHECKLIST_RESPONSES_TABLE)
        .select("checklist_item_id, result, comment")
        .eq("inspection_record_id", draft.id)
        .returns<Pick<ChecklistResponseRow, "checklist_item_id" | "result" | "comment">[]>(),
      supabase
        .from(INSPECTION_PHOTOS_TABLE)
        .select("id, storage_path, caption")
        .eq("inspection_record_id", draft.id)
        .returns<Pick<InspectionPhotoRow, "id" | "storage_path" | "caption">[]>(),
    ]);
    responseByItem = new Map((responses ?? []).map((r) => [r.checklist_item_id, { result: r.result, comment: r.comment }]));
    photos = photoRows ?? [];

    // R92-R100: register-fed auto-verification — a soft-stop assist, not a hard block. Computed
    // once per checklist (the same itp_items row backs every checklist_items row here), then shown
    // inline on every response row below.
    registerVerification = await checkRegisterVerification(supabase, {
      projectId: project.id,
      itpItemReferenceSpec: itpItem.reference_spec,
      itpItemAcceptanceCriteria: itpItem.acceptance_criteria,
    });
  }

  // Field execution (starting/answering/completing a checklist) is JAGS staff's job — the actual
  // field officer running the inspection — either JAGS staff, or (R76) the party actually assigned
  // to this activity self-inspecting their own section. A client or an unrelated party still can't.
  // Everyone with project access can still VIEW the checklist and its past results.
  const canExecute = session.isJagsStaff || isAssignedParty;

  const allAnswered = (items ?? []).every((i) => responseByItem.has(i.id));
  const answeredCount = (items ?? []).filter((i) => responseByItem.has(i.id)).length;
  const totalCount = (items ?? []).length;
  const answeredPct = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
  const RESULT_TONE: Record<string, "success" | "danger" | "warning"> = { pass: "success", fail: "danger", partial: "warning" };

  return (
    <div className="max-w-3xl">
      <RealtimeRefresh table="checklist_responses" />
      <p className="text-sm text-muted">
        {project.organizations?.name} · {project.name} ·{" "}
        <Link href={`/inspect/itps/${itp.id}`} className="hover:underline">
          {itp.itp_number}
        </Link>
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">
        Checklist <span className="doc-id text-lg text-muted">{template.checklist_number}</span>
      </h1>
      <p className="mt-1 text-sm text-ink">
        {itpItem.item_number}. {itpItem.activity}
      </p>

      {!draft && canExecute && (
        <div className="mt-6">
          <StartInspectionForm
            templateId={template.id}
            itpItemId={itpItem.id}
            projectId={project.id}
            projectName={project.name}
            itpNumber={itp.itp_number}
            activity={itpItem.activity}
          />
        </div>
      )}

      {!draft && !canExecute && (
        <p className="mt-6 rounded-md bg-off-white p-4 text-sm text-muted">
          Not started yet — a JAGS inspector or the party assigned to this activity will run this
          field inspection.
        </p>
      )}

      {draft && (
        <div className="mt-6 space-y-6">
          {totalCount > 0 && (
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-ink">
                  {answeredCount} of {totalCount} answered
                </span>
                <span className="text-muted">{answeredPct}%</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-off-white">
                <div
                  className="h-full rounded-full bg-gold transition-[width]"
                  style={{ width: `${answeredPct}%` }}
                />
              </div>
            </div>
          )}
          <div className="rounded-lg border border-border bg-surface">
            {(items ?? []).map((item) => (
              <ResponseRow
                key={item.id}
                templateId={template.id}
                inspectionRecordId={draft.id}
                checklistItemId={item.id}
                itemNumber={item.item_number}
                description={item.description}
                isMandatory={item.is_mandatory}
                initialResult={responseByItem.get(item.id)?.result ?? null}
                initialComment={responseByItem.get(item.id)?.comment ?? ""}
                readOnly={!canExecute}
                registerVerification={registerVerification}
              />
            ))}
            {(items ?? []).length === 0 && <p className="p-4 text-sm text-muted">This checklist has no items yet.</p>}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-medium text-ink">Photo evidence</h2>
            <div className="mt-3">
              <PhotoUpload projectId={project.id} inspectionRecordId={draft.id} photos={photos} readOnly={!canExecute} />
            </div>
          </div>

          {canExecute &&
            (allAnswered ? (
              <>
                <ConsistencyCheck templateId={template.id} inspectionRecordId={draft.id} />
                <CompleteInspectionForm templateId={template.id} inspectionRecordId={draft.id} />
              </>
            ) : (
              <p className="rounded-md bg-off-white p-4 text-sm text-muted">
                Answer every item above (Yes / No / N-A) to complete this inspection.
              </p>
            ))}
        </div>
      )}

      {session.isJagsStaff && (
        <div className="mt-8 rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-medium text-ink">Checklist items</h2>
          </div>
          <ul className="divide-y divide-border">
            {(items ?? []).map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink">
                {/* Icon-only drag handle — no real drag-and-drop reordering yet. */}
                <span aria-hidden className="select-none text-muted">⠿</span>
                <span className="doc-id text-muted">{item.item_number}.</span>
                <span className="flex-1">{item.description}</span>
                <Badge tone={item.is_mandatory ? "danger" : "neutral"}>{item.is_mandatory ? "Mandatory" : "Optional"}</Badge>
              </li>
            ))}
          </ul>
          <AddChecklistItemForm templateId={template.id} />
        </div>
      )}

      {(pastRecords ?? []).length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-medium text-ink">Past inspections</h2>
          <ul className="mt-2 space-y-1">
            {(pastRecords ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <Link href={`/inspect/inspections/${r.id}`} className="doc-id text-burgundy hover:underline">
                  {r.record_number}
                </Link>
                <Badge tone={RESULT_TONE[r.overall_result ?? ""] ?? "neutral"}>{r.overall_result}</Badge>
                <span className="text-muted">{r.inspection_date}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
