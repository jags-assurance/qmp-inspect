import { BreadcrumbTail } from "@/components/domain/breadcrumb-context";
import { notFound } from "next/navigation";
import { listResponseHistory, groupHistoryByItem } from "@/lib/checklists/response-history";
import { loadNumericSpecsForTemplate, loadNumericValues } from "@/lib/checklists/numeric-spec-query";
import { describeSpec } from "@/lib/checklists/numeric-response";
import { formatLocationForDisplay, mapsUrl } from "@/lib/checklists/location";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { listCorrectionRequestsForRecord } from "@/lib/checklists/correction-request-queries";
import { directoryClient } from "@/lib/ncrs/recipients";
import { RequestCorrectionForm, CorrectionRequestsPanel } from "./correction-requests";
import { canExecuteItpItem } from "@/lib/checklists/execution-parties";
import { Badge } from "@/components/ui/badge";
import {
  CHECKLIST_RESPONSES_TABLE,
  INSPECTION_EVIDENCE_DOCUMENTS_TABLE,
  INSPECTION_PHOTOS_TABLE,
  INSPECTION_RECORDS_TABLE,
  IRNS_TABLE,
  type ChecklistResponseRow,
  type InspectionPhotoRow,
  type InspectionRecordRow,
  type IrnRow,
} from "@/lib/checklists/db-types";
import { PhotoGallery } from "./photo-gallery";
import { groupLinkedDocumentsByItem, type LinkedDocumentRow } from "@/lib/checklists/linked-documents";
import { IssueIrnForm, VoidIrnForm } from "./issue-irn-form";
import { ReopenInspectionForm } from "./reopen-inspection-form";
import { DiscardDraftForm } from "./discard-draft-form";
import { ReviewInspectionForm } from "./review-inspection-form";
import { InspectionComments } from "./inspection-comments";
import { INSPECTION_COMMENTS_TABLE } from "@/lib/inspection-comments/db-types";
import { commentPostBlocker, groupThreads, type CommentThread, type InspectionCommentRow } from "@/lib/inspection-comments/logic";
import { reviewBlocker, type ReviewStatus } from "@/lib/checklists/review-logic";
import { parsePreviousResponses, reviewStatusLabel, staleSnapshotWarning } from "@/lib/checklists/template-ui-logic";
import { CHECKLIST_TEMPLATES_TABLE } from "@/lib/checklists/db-types";
import { listInspectionAmendments } from "@/lib/checklists/lifecycle-actions";
import {
  getLatestInspectionReportPdf,
  getLatestIrnPdf,
  draftInspectionNarrativeAction,
  saveInspectionNarrativeAction,
} from "@/lib/reports/actions";
import { InspectionReportPdfButton } from "./inspection-report-pdf-button";
import { IrnPdfButton } from "./irn-pdf-button";
import { NarrativeEditor } from "@/components/domain/narrative-editor";
import { isAiEnabledForProject } from "@/lib/ai/gate";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { PageGuide } from "@/components/domain/page-guide";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

const RESULT_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  pass: "success",
  fail: "danger",
  partial: "warning",
};

/** Read-only view of a completed inspection record — traceability header, every response, photo evidence, the inspector's signature, and IRN issuance/status. */
export default async function InspectionRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const tl = await getTranslator();
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select(
      "id, record_number, project_id, itp_item_id, project_name, itp_number, activity, location, client_name, applicable_standard, governing_drawing_reference, governing_drawing_revision, inspection_date, overall_result, notes, narrative, inspector_signature, checklist_template_id, inspector_id, signed_by_name, signed_at, witness_name, witness_signature, users!inspection_records_inspector_id_fkey(full_name)"
    )
    .eq("id", id)
    .maybeSingle<
      Pick<
        InspectionRecordRow,
        | "id"
        | "record_number"
        | "project_id"
        | "itp_item_id"
        | "project_name"
        | "itp_number"
        | "activity"
        | "location"
        | "client_name"
        | "applicable_standard"
        | "governing_drawing_reference"
        | "governing_drawing_revision"
        | "inspection_date"
        | "overall_result"
        | "notes"
        | "narrative"
        | "inspector_signature"
        | "checklist_template_id"
        | "inspector_id"
      > & {
        users: { full_name: string } | null;
        signed_by_name: string | null;
        signed_at: string | null;
        witness_name: string | null;
        witness_signature: string | null;
      }
    >();

  if (!record) notFound();
  const canIssueIrn = await canExecuteItpItem(supabase, record.itp_item_id);
  // Correction requests (M7): who may ask, and the list the viewer is allowed to see (RLS).
  const correctionRows = await listCorrectionRequestsForRecord(supabase, record.id);
  const requesterNames = new Map<string, string>();
  if (correctionRows.length > 0) {
    const { data: names } = await directoryClient(supabase)
      .from("users")
      .select("id, full_name")
      .in("id", [...new Set(correctionRows.map((c) => c.requested_by))])
      .returns<{ id: string; full_name: string | null }[]>();
    for (const n of names ?? []) requesterNames.set(n.id, n.full_name ?? "Unknown");
  }
  const correctionViews = correctionRows.map((c) => ({
    id: c.id,
    reason: c.reason,
    status: c.status,
    requesterName: requesterNames.get(c.requested_by) ?? "Unknown",
    createdAt: c.created_at,
    resolutionNote: c.resolution_note,
  }));
  const missingSignature = Boolean(record.overall_result) && (!record.inspector_signature || !record.signed_at);

  // Real FK linkage now that createNcrAction persists it (see lib/ncrs/actions.ts) — surfaces any
  // NCR raised directly from this record, both ways, instead of relying on someone finding it by
  // matching free text in the NCR register.
  const { data: linkedNcrs } = await supabase
    .from("ncrs")
    .select("id, ncr_number, severity, status")
    .eq("inspection_record_id", record.id)
    .returns<{ id: string; ncr_number: string; severity: string; status: string }[]>();

  // Versioning + review columns come from later migrations (20261106000100/200), so they are read
  // separately and best-effort: on a database without them everything below simply stays hidden.
  const { data: extra, error: extraError } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("checklist_template_version, review_status, reviewed_by, reviewed_at, review_comment, signed_by_user_id")
    .eq("id", id)
    .maybeSingle<{
      checklist_template_version: number | null;
      review_status: ReviewStatus | null;
      reviewed_by: string | null;
      reviewed_at: string | null;
      review_comment: string | null;
      signed_by_user_id: string | null;
    }>();
  const reviewSupported = !extraError && !!extra;

  // Reviewer comment threads (20261120000100): completed inspections only, hidden on a database
  // without the table. An unexpected read failure also hides the section rather than failing the page.
  let commentThreads: CommentThread[] | null = null;
  let commentsOpen = false;
  if (record.overall_result) {
    const { data: commentRows, error: commentsError } = await supabase
      .from(INSPECTION_COMMENTS_TABLE)
      .select(
        "id, project_id, inspection_record_id, parent_id, author_id, body, created_at, edited_at, resolved_at, resolved_by, users!inspection_comments_author_id_fkey(full_name)"
      )
      .eq("inspection_record_id", record.id)
      .order("created_at", { ascending: true })
      .returns<InspectionCommentRow[]>();
    if (!commentsError) {
      commentThreads = groupThreads(commentRows ?? []);
      const { data: commentProject } = await supabase.from("projects").select("status").eq("id", record.project_id).maybeSingle<{ status: string | null }>();
      commentsOpen = commentPostBlocker({ overallResult: record.overall_result, projectStatus: commentProject?.status ?? null }) === null;
    }
  }
  const reviewStatus = extra?.review_status ?? null;
  const reviewerName = extra?.reviewed_by
    ? ((await supabase.from("users").select("full_name").eq("id", extra.reviewed_by).maybeSingle<{ full_name: string }>()).data?.full_name ?? null)
    : null;
  let currentTemplateVersion: number | null = null;
  if (record.checklist_template_id && extra?.checklist_template_version != null) {
    const { data: tpl, error: tplError } = await supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select("version")
      .eq("id", record.checklist_template_id)
      .maybeSingle<{ version: number | null }>();
    currentTemplateVersion = tplError ? null : (tpl?.version ?? null);
  }
  const staleWarning = staleSnapshotWarning(extra?.checklist_template_version, currentTemplateVersion);
  const blocker = reviewSupported
    ? reviewBlocker({
        overallResult: record.overall_result,
        reviewStatus,
        reviewerId: session.userId,
        inspectorId: record.inspector_id,
        signedByUserId: extra?.signed_by_user_id ?? null,
        reviewerIsJagsStaff: session.isJagsStaff,
      })
    : null;
  const reviewBadge = reviewStatusLabel(reviewStatus);

  const latestReportPdf = await getLatestInspectionReportPdf(id);

  const [{ data: responses }, { data: photos }, { data: allIrns }, { data: linkedDocRows }] = await Promise.all([
    supabase
      .from(CHECKLIST_RESPONSES_TABLE)
      .select("checklist_item_id, result, comment, checklist_items(item_number, description, is_mandatory)")
      .eq("inspection_record_id", id)
      .returns<
        (Pick<ChecklistResponseRow, "checklist_item_id" | "result" | "comment"> & {
          checklist_items: { item_number: string; description: string; is_mandatory: boolean } | null;
        })[]
      >(),
    supabase
      .from(INSPECTION_PHOTOS_TABLE)
      .select("id, storage_path, caption")
      .eq("inspection_record_id", id)
      .returns<Pick<InspectionPhotoRow, "id" | "storage_path" | "caption">[]>(),
    supabase
      .from(IRNS_TABLE)
      .select("id, irn_number, release_date, voided_at, void_reason")
      .eq("inspection_record_id", id)
      .order("voided_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .returns<Pick<IrnRow, "id" | "irn_number" | "release_date" | "voided_at" | "void_reason">[]>(),
    supabase
      .from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE)
      .select("id, vault_document_id, checklist_item_id, vault_documents(title, document_reference, status)")
      .eq("inspection_record_id", id)
      .returns<LinkedDocumentRow[]>(),
  ]);
  const linkedDocsByItem = groupLinkedDocumentsByItem(linkedDocRows ?? []);
  // S4-20: measured readings (best-effort: empty until 20261113000500 is applied).
  const numericValues = await loadNumericValues(supabase, id);
  const numericSpecs = record.checklist_template_id ? await loadNumericSpecsForTemplate(supabase, record.checklist_template_id) : new Map();

  const irnList = allIrns ?? [];
  const liveIrn = irnList.find((i) => !i.voided_at) ?? null;
  // Only a live IRN is "the" IRN; voided ones are history and the issue form returns.
  const irn = liveIrn;
  const voidedIrns = irnList.filter((i) => i.voided_at);

  const latestIrnPdf = irn ? await getLatestIrnPdf(irn.id) : null;

  const amendments = await listInspectionAmendments(id);
  const responseHistory = await listResponseHistory(supabase, id);
  const historyByItem = groupHistoryByItem(responseHistory);

  // Perf: one batched Storage call for every photo's signed URL instead of each <PhotoThumbnail>
  // fetching its own client-side (see lib/storage/signed-urls.ts's doc comment).
  const photoUrls = await getSignedPhotoUrls(supabase, "inspection-evidence", (photos ?? []).map((p) => p.storage_path));
  const photosWithUrls = (photos ?? []).map((p) => ({ id: p.id, url: photoUrls.get(p.storage_path) ?? null, caption: p.caption }));

  const sortedResponses = [...(responses ?? [])].sort((a, b) =>
    (a.checklist_items?.item_number ?? "").localeCompare(b.checklist_items?.item_number ?? "", undefined, { numeric: true })
  );

  return (
    <div className="max-w-3xl">
      <Link
        href={`/inspect/checklists/${record.checklist_template_id}`}
        className="text-sm text-burgundy hover:underline"
      >
        <T>← Back to Checklist</T>
      </Link>
      {/* Certificate-style header band — traceability info at a glance, echoing the IRN layout below. */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-4 bg-burgundy px-5 py-4 text-white">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/70"><T>Inspection Record</T></p>
            <h1 className="doc-id text-2xl font-semibold">{record.record_number}</h1>
            <BreadcrumbTail label={record.record_number} />
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={RESULT_TONE[record.overall_result ?? ""] ?? "neutral"}>
              {(record.overall_result ?? "In progress").toString().toUpperCase()}
            </Badge>
            {session.isJagsStaff && missingSignature && (
              <Badge tone="warning"><T>Completed without a signature (legacy)</T></Badge>
            )}
            <PageGuide
              title={tl("Inspection record — how this works")}
              points={[
                "Read-only record of one completed inspection — every checklist response, photo evidence, the inspector's signature and any linked NCR/IRN.",
                "A fail or partial result surfaces a \"Raise NCR →\" link pre-filled with this project, ITP item and inspection record — the NCR raised is linked back to this record both ways.",
                "Once that linked NCR is closed, the original inspector is notified the activity is ready to re-inspect — closing the NCR's paperwork never auto-passes the record itself.",
                "An IRN (Inspection Release Note) can only be issued once the inspection has passed — it's blocked while a fail/partial result stands, and only the party assigned to execute this activity (or JAGS staff) can issue it, even though the button shows to anyone viewing a passed record.",
                "The narrative editor (AI-assisted draft, when AI is configured) only shows for JAGS staff.",
              ]}
            />
          </div>
        </div>
        {record.overall_result && (
          <div
            className={`px-5 py-2 text-sm font-medium ${
              record.overall_result === "pass"
                ? "bg-success/10 text-success"
                : record.overall_result === "fail"
                  ? "bg-danger/10 text-danger"
                  : "bg-warning/10 text-warning"
            }`}
          >
            {record.overall_result === "pass"
              ? "Inspection passed — all items satisfactory."
              : record.overall_result === "fail"
                ? "Inspection failed — raise/close an NCR and re-inspect before release."
                : "Conditional result — items marked N/A; confirm they genuinely do not apply before releasing."}
          </div>
        )}
        <div className="bg-surface px-5 py-3">
          <InspectionReportPdfButton inspectionRecordId={record.id} latest={latestReportPdf} completed={Boolean(record.overall_result)} signedAt={record.signed_at} />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted"><T>Activity</T></p>
            <p className="mt-0.5 text-ink">{record.activity}</p>
          </div>
          <div>
            <p className="text-xs text-muted"><T>Project</T></p>
            <p className="mt-0.5 text-ink">{record.project_name}</p>
          </div>
          <div>
            <p className="text-xs text-muted"><T>ITP</T></p>
            <p className="doc-id mt-0.5 text-ink">{record.itp_number}</p>
          </div>
          <div>
            <p className="text-xs text-muted"><T>Date</T></p>
            <p className="mt-0.5 text-ink">{record.inspection_date}</p>
          </div>
          {record.location && (
            <div>
              <p className="text-xs text-muted"><T>Location</T></p>
              <p className="mt-0.5 text-ink">
                {formatLocationForDisplay(record.location)}
                {mapsUrl(record.location) && (
                  <>
                    {" "}
                    <a href={mapsUrl(record.location)!} target="_blank" rel="noreferrer" className="text-xs text-burgundy hover:underline">
                      <T>Open in maps</T>
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted"><T>Inspector</T></p>
            <p className="mt-0.5 text-ink">{record.users?.full_name ?? "—"}</p>
          </div>
          {record.client_name && (
            <div>
              <p className="text-xs text-muted"><T>Client</T></p>
              <p className="mt-0.5 text-ink">{record.client_name}</p>
            </div>
          )}
          {record.applicable_standard && (
            <div>
              <p className="text-xs text-muted"><T>Applicable standard</T></p>
              <p className="mt-0.5 text-ink">{record.applicable_standard}</p>
            </div>
          )}
          {record.governing_drawing_reference && (
            <div>
              <p className="text-xs text-muted"><T>Governing drawing</T></p>
              <p className="doc-id mt-0.5 text-ink">
                {record.governing_drawing_reference}
                {record.governing_drawing_revision ? ` (Rev ${record.governing_drawing_revision})` : ""}
              </p>
            </div>
          )}
        </div>
        {record.checklist_template_id && (
          <div className="border-t border-border px-5 py-3">
            <Link
              href={`/inspect/checklists/${record.checklist_template_id}`}
              className="text-sm font-medium text-burgundy hover:underline"
            >
              <T>View checklist →</T>
            </Link>
          </div>
        )}
      </div>

      {staleWarning && (
        <p className="mt-6 rounded-md border border-warning/50 bg-warning/10 px-4 py-3 text-sm text-ink" role="status">
          <span className="font-medium"><T>Checklist changed since this inspection started.</T></span> {staleWarning}
        </p>
      )}

      {reviewSupported && record.overall_result && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-ink"><T>Review</T></h2>
            <Badge tone={reviewBadge.tone}>{reviewBadge.label}</Badge>
          </div>
          {reviewStatus ? (
            <p className="mt-2 text-sm text-ink">
              {reviewStatus === "approved" ? "Approved" : "Rejected"}
              {reviewerName ? ` by ${reviewerName}` : ""}
              {extra?.reviewed_at ? ` on ${new Date(extra.reviewed_at).toLocaleString()}` : ""}
              {extra?.review_comment ? <span className="block text-muted"><T>Comment:</T> {extra.review_comment}</span> : null}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted"><T>No review has been recorded for this inspection.</T></p>
          )}
          {session.isJagsStaff &&
            (blocker ? (
              <p className="mt-3 text-sm text-muted">{blocker}</p>
            ) : (
              <div className="mt-3 border-t border-border pt-3">
                <ReviewInspectionForm inspectionRecordId={record.id} hasPreviousReview={reviewStatus !== null} />
              </div>
            ))}
        </div>
      )}

      {commentThreads && (
        <InspectionComments
          inspectionRecordId={record.id}
          threads={commentThreads}
          userId={session.userId}
          isStaff={session.isJagsStaff}
          canPost={commentsOpen}
        />
      )}

      {(record.overall_result === "fail" || record.overall_result === "partial" || (linkedNcrs ?? []).length > 0) && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink"><T>Non-conformance</T></h2>
          {(linkedNcrs ?? []).length > 0 ? (
            <ul className="mt-2 space-y-1">
              {(linkedNcrs ?? []).map((ncr) => (
                <li key={ncr.id} className="text-sm">
                  <Link href={`/inspect/ncrs/${ncr.id}`} className="doc-id text-burgundy hover:underline">
                    {ncr.ncr_number}
                  </Link>{" "}
                  <Badge tone={ncr.status === "closed" ? "success" : "warning"}>{ncr.status.replace("_", " ")}</Badge>
                  {ncr.status === "closed" && (
                    <span className="ms-2 text-xs text-muted">
                      <T>Closed — re-inspect this activity to confirm the fix, then issue the IRN from a passing record.</T>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                <T>This inspection</T> {record.overall_result === "fail" ? "failed" : "partially passed"} <T>— raise an NCR against the specific activity so the corrective-action trail is linked back to this record.</T>
              </p>
              <Link
                href={`/inspect/ncrs/new?project_id=${record.project_id}&itp_item_id=${record.itp_item_id}&inspection_record_id=${record.id}&description=${encodeURIComponent(
                  `${record.activity} (${record.record_number}) — see recorded responses/comments below.`
                )}`}
                className="mt-3 inline-block rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white"
              >
                <T>Raise NCR →</T>
              </Link>
            </>
          )}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-medium text-ink"><T>Responses</T></h2>
        </div>
        <ul className="divide-y divide-border">
          {sortedResponses.map((r) => (
            <li key={r.checklist_item_id} className="px-4 py-3 text-sm">
              <p className="text-ink">
                <span className="doc-id text-muted">{r.checklist_items?.item_number}.</span> {r.checklist_items?.description}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone={r.result === "yes" ? "success" : r.result === "no" ? "danger" : "neutral"}>{r.result.toUpperCase()}</Badge>
                {numericValues.has(r.checklist_item_id) && (
                  <span className="font-medium text-ink">
                    {numericValues.get(r.checklist_item_id)}
                    {numericSpecs.get(r.checklist_item_id)?.unit ? ` ${numericSpecs.get(r.checklist_item_id)?.unit}` : ""}
                    {numericSpecs.get(r.checklist_item_id) && <span className="font-normal text-muted"> <T>(limit:</T> {describeSpec(numericSpecs.get(r.checklist_item_id)!)})</span>}
                  </span>
                )}
                {r.comment && <span className="text-muted">{r.comment}</span>}
              </div>
              {(linkedDocsByItem.get(r.checklist_item_id) ?? []).length > 0 && (
                <ul className="mt-2 space-y-1" aria-label={`Documents linked to item ${r.checklist_items?.item_number ?? ""}`}>
                  {(linkedDocsByItem.get(r.checklist_item_id) ?? []).map((d) => (
                    <li key={d.linkId} className="flex flex-wrap items-center gap-2 text-xs">
                      <span aria-hidden="true">📎</span>
                      <Link
                        href={`/inspect/vault/${record.project_id}/document/${d.vaultDocumentId}`}
                        className="text-burgundy hover:underline [overflow-wrap:anywhere]"
                      >
                        {d.title}
                      </Link>
                      {d.reference && <span className="doc-id text-muted">{d.reference}</span>}
                      <Badge tone={d.status === "approved" ? "success" : d.status === "rejected" ? "danger" : "neutral"}>{d.statusLabel}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {sortedResponses.length === 0 && <li className="px-4 py-6 text-center text-muted"><T>No responses recorded.</T></li>}
        </ul>
      </div>

      {session.isJagsStaff && (
        <div className="mt-6">
          <NarrativeEditor
            recordIdFieldName="inspection_record_id"
            recordId={record.id}
            projectId={record.project_id}
            aiConfigured={await isAiEnabledForProject(supabase, record.project_id)}
            initialNarrative={record.narrative}
            draftAction={draftInspectionNarrativeAction}
            saveAction={saveInspectionNarrativeAction}
          />
        </div>
      )}

      {record.notes && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink"><T>Notes</T></h2>
          <p className="mt-1 text-sm text-muted">{record.notes}</p>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-ink"><T>Photo evidence</T></h2>
        <div className="mt-3">
          <PhotoGallery photos={photosWithUrls} />
        </div>
      </div>

      {record.inspector_signature && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink"><T>Inspector signature</T></h2>
          {/* Captured as a canvas data URL — see components/domain/signature-pad.tsx. */}
          <div className="mt-2 inline-block rounded-md border border-border bg-off-white px-4 pb-2 pt-3">
            <img src={record.inspector_signature} alt="Inspector signature" className="h-28 w-auto" />
            <div className="mt-1 w-64 border-t border-ink/30 pt-1 text-xs text-muted">
              {record.signed_by_name ?? record.users?.full_name ?? "Inspector"} ·{" "}
              {record.signed_at ? new Date(record.signed_at).toLocaleString() : record.inspection_date}
            </div>
          </div>
          {record.witness_signature && (
            <div className="mt-3 inline-block rounded-md border border-border bg-off-white px-4 pb-2 pt-3 sm:ms-4">
              <img src={record.witness_signature} alt="Witness signature" className="h-28 w-auto" />
              <div className="mt-1 w-64 border-t border-ink/30 pt-1 text-xs text-muted">
                <T>Witness:</T> {record.witness_name ?? "—"}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-ink"><T>Inspection Release Note</T></h2>
        {irn ? (
          <div className="mt-2">
            <p className="text-sm text-ink">
              <span className="doc-id">{irn.irn_number}</span> <T>· Released</T> {irn.release_date}{" "}
              {irn.voided_at && <Badge tone="danger"><T>VOID</T></Badge>}
            </p>
            {irn.voided_at ? (
              <p className="mt-1 text-sm text-danger">
                <T>Voided</T> {new Date(irn.voided_at).toLocaleDateString()}: {irn.void_reason}
              </p>
            ) : (
              <>
                <div className="mt-2">
                  <IrnPdfButton irnId={irn.id} latest={latestIrnPdf} changedAt={record.signed_at} />
                </div>
                {session.isJagsStaff && <VoidIrnForm irnId={irn.id} />}
              </>
            )}
          </div>
        ) : record.overall_result === "pass" || record.overall_result === "partial" ? (
          <div className="mt-2">
            {voidedIrns.length > 0 && (
              <p className="mb-2 text-sm text-muted"><T>The previous IRN was voided. Issue a replacement.</T></p>
            )}
            {canIssueIrn ? (
              <IssueIrnForm inspectionRecordId={record.id} />
            ) : (
              <p className="text-sm text-muted"><T>Only JAGS staff or the assigned party can issue the IRN.</T></p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted"><T>An IRN can be issued once the inspection has passed.</T></p>
        )}
        {voidedIrns.length > 0 && (
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted"><T>IRN history</T> ({voidedIrns.length})</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {voidedIrns.map((v) => (
                <li key={v.id}>
                  <span className="doc-id">{v.irn_number}</span> <Badge tone="danger"><T>VOID</T></Badge>{" "}
                  <span className="text-danger">
                    {v.voided_at ? new Date(v.voided_at).toLocaleDateString() : ""}: {v.void_reason}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {!record.overall_result && (session.isJagsStaff || record.inspector_id === session.userId) && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <DiscardDraftForm inspectionRecordId={record.id} />
        </div>
      )}

      {session.isJagsStaff && record.overall_result && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <ReopenInspectionForm inspectionRecordId={record.id} />
        </div>
      )}

      {record.overall_result && canIssueIrn && !isAdminStaff(session) && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <RequestCorrectionForm inspectionRecordId={record.id} />
        </div>
      )}

      <CorrectionRequestsPanel requests={correctionViews} canResolve={session.isJagsStaff} />

      {responseHistory.length > 0 && (
        <details className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm">
          <summary className="cursor-pointer font-medium text-burgundy"><T>Answer changes (</T>{responseHistory.length})</summary>
          <p className="mt-2 text-xs text-muted"><T>Earlier answers, newest first.</T></p>
          <ul className="mt-2 divide-y divide-border">
            {[...historyByItem.entries()].map(([itemId, list]) => {
              const label = sortedResponses.find((r) => r.checklist_item_id === itemId)?.checklist_items;
              return (
                <li key={itemId} className="py-2">
                  <p className="text-ink">
                    <span className="doc-id text-muted">{label?.item_number}.</span> {label?.description}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {list.map((h) => (
                      <li key={h.id}>
                        <T>was</T> <span className="font-medium text-ink">{(h.old_result ?? "").toUpperCase() || "-"}</span>
                        {h.old_numeric_value ? ` (${h.old_numeric_value})` : ""}
                        {h.old_comment ? `, "${h.old_comment}"` : ""} <T>- changed</T> {new Date(h.changed_at).toLocaleString("en-GB")}
                        {h.changed_by_name ? ` by ${h.changed_by_name}` : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {amendments.length > 0 && (
        <details className="mt-6 rounded-lg border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink"><T>Amendment history</T> ({amendments.length})</summary>
          <ul className="mt-2 divide-y divide-border text-sm">
            {amendments.map((a) => (
              <li key={a.id} className="py-2">
                <p className="text-ink">
                  <T>Re-opened</T> {new Date(a.amended_at).toLocaleString()} <T>by</T> {a.users?.full_name ?? "JAGS staff"}
                </p>
                <p className="text-muted"><T>Reason:</T> {a.reason}</p>
                <p className="text-xs text-muted">
                  <T>Previous result:</T> {(a.previous_overall_result ?? "—").toUpperCase()}
                  {a.previous_signed_by_name ? ` · signed by ${a.previous_signed_by_name}` : ""}
                  {a.previous_signed_at ? ` on ${new Date(a.previous_signed_at).toLocaleString()}` : ""}
                  {a.previous_review_status ? ` · previous review: ${a.previous_review_status}` : ""}
                </p>
                <PreviousAnswers amendmentId={a.id} responses={parsePreviousResponses(a.previous_responses)} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const PREV_TONE: Record<string, "success" | "danger" | "neutral"> = { yes: "success", no: "danger", na: "neutral" };

/** Collapsible snapshot of the answers that were cleared when the inspection was re-opened. */
function PreviousAnswers({ amendmentId, responses }: { amendmentId: string; responses: ReturnType<typeof parsePreviousResponses> }) {
  if (responses.length === 0) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-medium text-burgundy"><T>Previous answers (</T>{responses.length})</summary>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-off-white" aria-label={`Answers before re-open ${amendmentId}`}>
        {responses.map((r) => (
          <li key={r.checklist_item_id} className="px-3 py-2">
            <p className="text-ink">
              {r.item_number && <span className="doc-id text-muted">{r.item_number}. </span>}
              {r.description ?? "Item"}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone={PREV_TONE[r.result] ?? "neutral"}>{r.result.toUpperCase()}</Badge>
              {r.comment && <span className="text-muted">{r.comment}</span>}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
