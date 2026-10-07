import { notFound } from "next/navigation";
import { formatLocationForDisplay, mapsUrl } from "@/lib/checklists/location";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { canExecuteItpItem } from "@/lib/checklists/execution-parties";
import { Badge } from "@/components/ui/badge";
import {
  CHECKLIST_RESPONSES_TABLE,
  INSPECTION_PHOTOS_TABLE,
  INSPECTION_RECORDS_TABLE,
  IRNS_TABLE,
  type ChecklistResponseRow,
  type InspectionPhotoRow,
  type InspectionRecordRow,
  type IrnRow,
} from "@/lib/checklists/db-types";
import { PhotoGallery } from "./photo-gallery";
import { IssueIrnForm, VoidIrnForm } from "./issue-irn-form";
import { ReopenInspectionForm } from "./reopen-inspection-form";
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
import { isAiConfigured } from "@/lib/ai/gate";
import { getSignedPhotoUrls } from "@/lib/storage/signed-urls";
import { PageGuide } from "@/components/domain/page-guide";

const RESULT_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  pass: "success",
  fail: "danger",
  partial: "warning",
};

/** Read-only view of a completed inspection record — traceability header, every response, photo evidence, the inspector's signature, and IRN issuance/status. */
export default async function InspectionRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select(
      "id, record_number, project_id, itp_item_id, project_name, itp_number, activity, location, client_name, applicable_standard, governing_drawing_reference, governing_drawing_revision, inspection_date, overall_result, notes, narrative, inspector_signature, checklist_template_id, inspector_id, signed_by_name, signed_at, witness_name, witness_signature, users(full_name)"
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

  // Real FK linkage now that createNcrAction persists it (see lib/ncrs/actions.ts) — surfaces any
  // NCR raised directly from this record, both ways, instead of relying on someone finding it by
  // matching free text in the NCR register.
  const { data: linkedNcrs } = await supabase
    .from("ncrs")
    .select("id, ncr_number, severity, status")
    .eq("inspection_record_id", record.id)
    .returns<{ id: string; ncr_number: string; severity: string; status: string }[]>();

  const latestReportPdf = await getLatestInspectionReportPdf(id);

  const [{ data: responses }, { data: photos }, { data: allIrns }] = await Promise.all([
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
  ]);

  const irnList = allIrns ?? [];
  const liveIrn = irnList.find((i) => !i.voided_at) ?? null;
  // Only a live IRN is "the" IRN; voided ones are history and the issue form returns.
  const irn = liveIrn;
  const voidedIrns = irnList.filter((i) => i.voided_at);

  const latestIrnPdf = irn ? await getLatestIrnPdf(irn.id) : null;

  const amendments = await listInspectionAmendments(id);

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
        ← Back to Checklist
      </Link>
      {/* Certificate-style header band — traceability info at a glance, echoing the IRN layout below. */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-4 bg-burgundy px-5 py-4 text-white">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/70">Inspection Record</p>
            <h1 className="doc-id text-2xl font-semibold">{record.record_number}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone={RESULT_TONE[record.overall_result ?? ""] ?? "neutral"}>
              {(record.overall_result ?? "In progress").toString().toUpperCase()}
            </Badge>
            <PageGuide
              title="Inspection record — how this works"
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
          <InspectionReportPdfButton inspectionRecordId={record.id} latest={latestReportPdf} />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Activity</p>
            <p className="mt-0.5 text-ink">{record.activity}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Project</p>
            <p className="mt-0.5 text-ink">{record.project_name}</p>
          </div>
          <div>
            <p className="text-xs text-muted">ITP</p>
            <p className="doc-id mt-0.5 text-ink">{record.itp_number}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Date</p>
            <p className="mt-0.5 text-ink">{record.inspection_date}</p>
          </div>
          {record.location && (
            <div>
              <p className="text-xs text-muted">Location</p>
              <p className="mt-0.5 text-ink">
                {formatLocationForDisplay(record.location)}
                {mapsUrl(record.location) && (
                  <>
                    {" "}
                    <a href={mapsUrl(record.location)!} target="_blank" rel="noreferrer" className="text-xs text-burgundy hover:underline">
                      Open in maps
                    </a>
                  </>
                )}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted">Inspector</p>
            <p className="mt-0.5 text-ink">{record.users?.full_name ?? "—"}</p>
          </div>
          {record.client_name && (
            <div>
              <p className="text-xs text-muted">Client</p>
              <p className="mt-0.5 text-ink">{record.client_name}</p>
            </div>
          )}
          {record.applicable_standard && (
            <div>
              <p className="text-xs text-muted">Applicable standard</p>
              <p className="mt-0.5 text-ink">{record.applicable_standard}</p>
            </div>
          )}
          {record.governing_drawing_reference && (
            <div>
              <p className="text-xs text-muted">Governing drawing</p>
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
              View checklist →
            </Link>
          </div>
        )}
      </div>

      {(record.overall_result === "fail" || record.overall_result === "partial" || (linkedNcrs ?? []).length > 0) && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Non-conformance</h2>
          {(linkedNcrs ?? []).length > 0 ? (
            <ul className="mt-2 space-y-1">
              {(linkedNcrs ?? []).map((ncr) => (
                <li key={ncr.id} className="text-sm">
                  <Link href={`/inspect/ncrs/${ncr.id}`} className="doc-id text-burgundy hover:underline">
                    {ncr.ncr_number}
                  </Link>{" "}
                  <Badge tone={ncr.status === "closed" ? "success" : "warning"}>{ncr.status.replace("_", " ")}</Badge>
                  {ncr.status === "closed" && (
                    <span className="ml-2 text-xs text-muted">
                      Closed — re-inspect this activity to confirm the fix, then issue the IRN from
                      a passing record.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                This inspection {record.overall_result === "fail" ? "failed" : "partially passed"} —
                raise an NCR against the specific activity so the corrective-action trail is linked
                back to this record.
              </p>
              <Link
                href={`/inspect/ncrs/new?project_id=${record.project_id}&itp_item_id=${record.itp_item_id}&inspection_record_id=${record.id}&description=${encodeURIComponent(
                  `${record.activity} (${record.record_number}) — see recorded responses/comments below.`
                )}`}
                className="mt-3 inline-block rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white"
              >
                Raise NCR →
              </Link>
            </>
          )}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-medium text-ink">Responses</h2>
        </div>
        <ul className="divide-y divide-border">
          {sortedResponses.map((r) => (
            <li key={r.checklist_item_id} className="px-4 py-3 text-sm">
              <p className="text-ink">
                <span className="doc-id text-muted">{r.checklist_items?.item_number}.</span> {r.checklist_items?.description}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone={r.result === "yes" ? "success" : r.result === "no" ? "danger" : "neutral"}>{r.result.toUpperCase()}</Badge>
                {r.comment && <span className="text-muted">{r.comment}</span>}
              </div>
            </li>
          ))}
          {sortedResponses.length === 0 && <li className="px-4 py-6 text-center text-muted">No responses recorded.</li>}
        </ul>
      </div>

      {session.isJagsStaff && (
        <div className="mt-6">
          <NarrativeEditor
            recordIdFieldName="inspection_record_id"
            recordId={record.id}
            projectId={record.project_id}
            aiConfigured={isAiConfigured()}
            initialNarrative={record.narrative}
            draftAction={draftInspectionNarrativeAction}
            saveAction={saveInspectionNarrativeAction}
          />
        </div>
      )}

      {record.notes && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Notes</h2>
          <p className="mt-1 text-sm text-muted">{record.notes}</p>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-ink">Photo evidence</h2>
        <div className="mt-3">
          <PhotoGallery photos={photosWithUrls} />
        </div>
      </div>

      {record.inspector_signature && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Inspector signature</h2>
          {/* Captured as a canvas data URL — see components/domain/signature-pad.tsx. */}
          <div className="mt-2 inline-block rounded-md border border-border bg-off-white px-4 pb-2 pt-3">
            <img src={record.inspector_signature} alt="Inspector signature" className="h-28 w-auto" />
            <div className="mt-1 w-64 border-t border-ink/30 pt-1 text-xs text-muted">
              {record.signed_by_name ?? record.users?.full_name ?? "Inspector"} ·{" "}
              {record.signed_at ? new Date(record.signed_at).toLocaleString() : record.inspection_date}
            </div>
          </div>
          {record.witness_signature && (
            <div className="mt-3 inline-block rounded-md border border-border bg-off-white px-4 pb-2 pt-3 sm:ml-4">
              <img src={record.witness_signature} alt="Witness signature" className="h-28 w-auto" />
              <div className="mt-1 w-64 border-t border-ink/30 pt-1 text-xs text-muted">
                Witness: {record.witness_name ?? "—"}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-ink">Inspection Release Note</h2>
        {irn ? (
          <div className="mt-2">
            <p className="text-sm text-ink">
              <span className="doc-id">{irn.irn_number}</span> · Released {irn.release_date}{" "}
              {irn.voided_at && <Badge tone="danger">VOID</Badge>}
            </p>
            {irn.voided_at ? (
              <p className="mt-1 text-sm text-danger">
                Voided {new Date(irn.voided_at).toLocaleDateString()}: {irn.void_reason}
              </p>
            ) : (
              <>
                <div className="mt-2">
                  <IrnPdfButton irnId={irn.id} latest={latestIrnPdf} />
                </div>
                {session.isJagsStaff && <VoidIrnForm irnId={irn.id} />}
              </>
            )}
          </div>
        ) : record.overall_result === "pass" || record.overall_result === "partial" ? (
          <div className="mt-2">
            {voidedIrns.length > 0 && (
              <p className="mb-2 text-sm text-muted">The previous IRN was voided; a replacement can be issued.</p>
            )}
            {canIssueIrn ? (
              <IssueIrnForm inspectionRecordId={record.id} />
            ) : (
              <p className="text-sm text-muted">Only JAGS staff or the party assigned to execute this activity can issue its IRN.</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">An IRN can only be issued once this inspection has passed (or conditionally passed).</p>
        )}
        {voidedIrns.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">IRN history</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {voidedIrns.map((v) => (
                <li key={v.id}>
                  <span className="doc-id">{v.irn_number}</span> <Badge tone="danger">VOID</Badge>{" "}
                  <span className="text-danger">
                    {v.voided_at ? new Date(v.voided_at).toLocaleDateString() : ""}: {v.void_reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {session.isJagsStaff && record.overall_result && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <ReopenInspectionForm inspectionRecordId={record.id} />
        </div>
      )}

      {amendments.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Amendment history</h2>
          <ul className="mt-2 divide-y divide-border text-sm">
            {amendments.map((a) => (
              <li key={a.id} className="py-2">
                <p className="text-ink">
                  Re-opened {new Date(a.amended_at).toLocaleString()} by {a.users?.full_name ?? "JAGS staff"}
                </p>
                <p className="text-muted">Reason: {a.reason}</p>
                <p className="text-xs text-muted">
                  Previous result: {(a.previous_overall_result ?? "—").toUpperCase()}
                  {a.previous_signed_by_name ? ` · signed by ${a.previous_signed_by_name}` : ""}
                  {a.previous_signed_at ? ` on ${new Date(a.previous_signed_at).toLocaleString()}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
