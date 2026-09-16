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
import { ChecklistExecutionPanel } from "./checklist-execution-panel";
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
  // self-inspection is that party's own spec'd role, not JAGS staff's alone. But holding SOME
  // intervention level on the activity isn't enough on its own: an independent verifier (TPI/lab
  // holding a Hold/Witness point) or the project owner (client holding a Review point) exists on the
  // grid specifically to check someone else's work after the fact — they don't do the field data
  // entry themselves, or the independent-verification point is meaningless. Only the party actually
  // performing/self-inspecting the work — subcontractor or main contractor — can run the checklist;
  // client and tpi_lab are sign-off-only regardless of which intervention level they hold here.
  const EXECUTING_PARTY_TYPES = new Set(["subcontractor", "main_contractor"]);
  const { data: stakeholderParties } = await supabase
    .from("activity_party_intervention")
    .select("project_parties(user_id, party_type)")
    .eq("itp_item_id", itpItem.id)
    .returns<{ project_parties: { user_id: string | null; party_type: string } | null }[]>();
  const isAssignedParty = (stakeholderParties ?? []).some(
    (row) =>
      row.project_parties?.user_id === session.userId &&
      EXECUTING_PARTY_TYPES.has(row.project_parties.party_type)
  );
  // Distinguishes "you hold a sign-off point here but don't do field entry" from "your party isn't
  // on this activity at all" — both land on !isAssignedParty, but the guidance differs.
  const isSignoffOnlyParty = (stakeholderParties ?? []).some(
    (row) => row.project_parties?.user_id === session.userId && !EXECUTING_PARTY_TYPES.has(row.project_parties.party_type)
  );

  // Whether the viewer is linked to SOME project party at all — used to tell "you're a project
  // party, just not this activity's" apart from "you have no party link on this project," since the
  // former reads as a dead end otherwise (see the not-canExecute message below).
  const { data: ownPartyLink } = session.isJagsStaff
    ? { data: null }
    : await supabase
        .from("project_parties")
        .select("id")
        .eq("project_id", project.id)
        .eq("user_id", session.userId)
        .maybeSingle<{ id: string }>();

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
  // field officer running the inspection — either JAGS staff, or (R76) the performing contractor
  // (subcontractor/main contractor) self-inspecting their own section. An independent verifier
  // (TPI/lab), the client, or an unrelated party still can't — see EXECUTING_PARTY_TYPES above.
  // Everyone with project access can still VIEW the checklist and its past results.
  const canExecute = session.isJagsStaff || isAssignedParty;

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
          {isSignoffOnlyParty
            ? "Not started yet. You hold an independent sign-off point on this activity (see the intervention grid on the ITP page) — the contractor performing the work fills in this checklist, and you'll be notified to sign off once it's ready."
            : ownPartyLink
              ? "Not started yet. Your organisation doesn't hold a sign-off point on this specific activity, so a JAGS inspector or the party assigned to it will run this field inspection."
              : "Not started yet — a JAGS inspector or the party assigned to this activity will run this field inspection."}
        </p>
      )}

      {draft && (
        <div className="mt-6 space-y-6">
          <ChecklistExecutionPanel
            templateId={template.id}
            inspectionRecordId={draft.id}
            items={(items ?? []).map((i) => ({
              id: i.id,
              item_number: i.item_number,
              description: i.description,
              is_mandatory: i.is_mandatory,
            }))}
            initialResponses={responseByItem}
            readOnly={!canExecute}
            registerVerification={registerVerification}
            canExecute={canExecute}
            photoSlot={
              <div className="rounded-lg border border-border bg-surface p-4">
                <h2 className="text-sm font-medium text-ink">Photo evidence</h2>
                <div className="mt-3">
                  <PhotoUpload projectId={project.id} inspectionRecordId={draft.id} photos={photos} readOnly={!canExecute} />
                </div>
              </div>
            }
            completeSlot={
              <>
                <ConsistencyCheck templateId={template.id} inspectionRecordId={draft.id} />
                <CompleteInspectionForm templateId={template.id} inspectionRecordId={draft.id} />
              </>
            }
            incompleteSlot={
              <p className="rounded-md bg-off-white p-4 text-sm text-muted">
                Answer every item above (Yes / No / N-A) to complete this inspection.
              </p>
            }
          />
        </div>
      )}

      {session.isJagsStaff && (
        // Round-table finding: template-editing controls (drag handle, +Add item) used to sit
        // directly under the field-answering view, in the default line of sight of an inspector who
        // just wants to fill in the checklist. Collapsed behind a <details> disclosure, closed by
        // default, so answering and editing read as two distinct modes rather than one crowded page.
        <details className="mt-8 rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 font-medium text-ink">
            Edit checklist template
          </summary>
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
        </details>
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
