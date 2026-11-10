"use client";
import { formatLocationForDisplay } from "@/lib/checklists/location";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import type {
  AssignmentConclusion,
  AssignmentStatus,
  AssignmentType,
  MeasurementResult,
  PunchItemStatus,
  StandaloneAssignmentMeasurementRow,
  StandaloneAssignmentPhotoRow,
  StandaloneAssignmentPunchItemRow,
  StandaloneAssignmentSignatureRow,
} from "@/lib/standalone/actions";
import { deleteMeasurementAction, deletePhotoAction, deleteSignatureAction } from "@/lib/standalone/actions";
import { PunchToggleButton } from "./punch-toggle-button";
import { ReopenForm } from "./reopen-form";
import { AddMeasurementForm } from "./add-measurement-form";
import { SuggestMeasurements } from "./suggest-measurements";
import { AddPunchItemForm } from "./add-punch-item-form";
import { PhotoUpload } from "./photo-upload";
import { SignaturePad } from "./signature-pad";
import { NotesForm } from "./notes-form";
import { FinalizeForm } from "./finalize-form";
import { IssueClearanceForm } from "./issue-clearance-form";
import { AssignmentEvidenceDocuments, type VaultDocumentOption } from "./assignment-evidence-documents";
import type { StandaloneAssignmentEvidenceDocumentRow } from "@/lib/standalone/actions";
import { Tx } from "@/components/domain/tx";
import { MoreDetails } from "@/components/domain/more-details";
import { Button } from "@/components/ui/button";
import { ResponsiveTable } from "@/components/ui/responsive-table";

interface Assignment {
  id: string;
  project_id: string;
  manufacturer: string | null;
  model: string | null;
  serial_tag: string | null;
  location: string | null;
  assignment_date: string | null;
  status: AssignmentStatus;
  conclusion: AssignmentConclusion | null;
  notes: string | null;
  assignment_type: AssignmentType;
}

const TABS = [
  { key: "measurements", label: "Measurements" },
  { key: "photos", label: "Photos" },
  { key: "evidence_documents", label: "Evidence Documents" },
  { key: "punch_list", label: "Punch List" },
  { key: "signatures", label: "Witness Signatures" },
  { key: "notes", label: "Notes" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const MEASUREMENT_RESULT_TONE: Record<MeasurementResult, "success" | "danger"> = {
  pass: "success",
  fail: "danger",
};

const PUNCH_STATUS_TONE: Record<PunchItemStatus, "warning" | "success"> = {
  open: "warning",
  closed: "success",
};

const CONCLUSION_LABEL: Record<AssignmentConclusion, string> = {
  pass: "Pass",
  conditional_pass: "Conditional Pass",
  fail: "Fail",
};

const CONCLUSION_TONE: Record<AssignmentConclusion, "success" | "warning" | "danger"> = {
  pass: "success",
  conditional_pass: "warning",
  fail: "danger",
};

export function AssignmentWorkspace({
  assignment,
  measurements,
  photos,
  photoSignedUrls,
  evidenceDocuments,
  vaultDocuments,
  projectId,
  vaultFolders = [],
  punchItems,
  signatures,
  linkedOpenPunchCount,
  linkedTotalPunchCount,
  canManage,
  canClose,
  isAdmin,
}: {
  assignment: Assignment;
  measurements: StandaloneAssignmentMeasurementRow[];
  photos: StandaloneAssignmentPhotoRow[];
  /** storage_path -> signed URL, batched server-side (lib/storage/signed-urls.ts) — a path missing
   *  from this map (deleted object, sign failure) just renders an empty frame, never a broken image. */
  photoSignedUrls: Map<string, string>;
  evidenceDocuments: (StandaloneAssignmentEvidenceDocumentRow & { title: string; documentReference: string | null })[];
  vaultDocuments: VaultDocumentOption[];
  projectId?: string;
  vaultFolders?: { id: string; key: string; name: string }[];
  punchItems: StandaloneAssignmentPunchItemRow[];
  signatures: StandaloneAssignmentSignatureRow[];
  /** Open count on the project-wide punch_list_items row(s) this assignment's conditional-pass
   *  created — the real R16 clearance gate, distinct from `punchItems` above (the assignment's own
   *  internal punch tab, a separate table with no bearing on clearance). */
  linkedOpenPunchCount: number;
  /** Total linked punch-list items (open + closed) behind the same clearance gate — lets the banner
   *  below read as an explicit "N of M closed" ratio rather than just a remaining-open count. */
  linkedTotalPunchCount: number;
  /** Every mutating control below (add measurement/punch item/photo/signature, finalize, issue
   * clearance) is gated server-side by requireStandaloneAccess/canRunStandaloneAssignment
   * (lib/standalone/actions.ts): true for JAGS staff, or for anyone specifically granted the
   * run_standalone_assignment permission (Full Client-Managed tier only). Without this prop, the
   * controls would still render for any logged-in party who fails that check, who could click "+
   * Add measurement" or "Finalize" and only find out it was blocked after submitting. Gating on
   * isDraft alone was never enough; it has to be isDraft && canManage. */
  canManage: boolean;
  /** close_punch_item authority (JAGS admin or permission holder): gates Mark closed and clearance. */
  canClose: boolean;
  /** JAGS admin: may reopen a completed assignment. */
  isAdmin: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("measurements");
  const isDraft = assignment.status === "draft";
  const isConditionalOpen = assignment.status === "conditional_open";
  const ownOpenPunchCount = punchItems.filter((p) => p.status === "open").length;
  const clearanceBlockedCount = linkedOpenPunchCount + ownOpenPunchCount;
  // Distinct from isDraft: isDraft is about the assignment's actual state (still correct to show
  // as "Draft" to anyone), canEdit is about whether THIS viewer may mutate it. Every action this
  // gates is permission-checked server-side (lib/standalone/actions.ts) — this just stops the
  // controls from rendering for a party who'd only find that out after clicking submit.
  const canEdit = isDraft && canManage;
  const canEditPunch = (isDraft || isConditionalOpen) && canManage;
  // Photos and evidence documents are still allowed while awaiting clearance.
  const canAddEvidence = canEditPunch;
  const openPunchCount = punchItems.filter((p) => p.status === "open").length;
  const { gateSubmit, dialog } = useConfirm();
  const tabCounts: Record<TabKey, number | null> = {
    measurements: measurements.length,
    photos: photos.length,
    evidence_documents: evidenceDocuments.length,
    punch_list: punchItems.length,
    signatures: signatures.length,
    notes: null,
  };

  return (
    <div>
      {dialog}
      <StatGrid>
        <StatTile label="Measurements" value={measurements.length} />
        <StatTile label="Photos" value={photos.length} />
        <StatTile label="Open punch items" value={openPunchCount} />
        <StatTile
          label="Status"
          value={
            isDraft ? (
              <Badge tone="neutral"><Tx>Draft</Tx></Badge>
            ) : (
              <Badge tone={assignment.conclusion ? CONCLUSION_TONE[assignment.conclusion] : "neutral"}>
                {assignment.conclusion ? CONCLUSION_LABEL[assignment.conclusion] : "Completed"}
                {isConditionalOpen ? " (awaiting clearance)" : ""}
              </Badge>
            )
          }
        />
      </StatGrid>

      {isConditionalOpen && (
        <div role="status" className="mt-4 flex items-start gap-3 rounded-lg border-2 border-warning bg-warning/10 p-4 text-sm text-ink">
          <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning text-sm font-bold text-white">!</span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-warning">
              {linkedTotalPunchCount - linkedOpenPunchCount} <Tx>of</Tx> {linkedTotalPunchCount} <Tx>linked punch items closed</Tx>
              {clearanceBlockedCount > 0 ? " — clearance blocked" : " — ready to issue clearance"}
            </p>
            <MoreDetails label="Details">
              <p>
                {clearanceBlockedCount > 0
                  ? `This assignment stays conditionally open until every linked punch item on the project punch list${ownOpenPunchCount > 0 ? ` and the ${ownOpenPunchCount} open item(s) on this assignment's own Punch List tab` : ""} is closed.`
                  : "All linked punch items are closed. Issue clearance below to complete this assignment."}
              </p>
            </MoreDetails>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm shadow-xs sm:mt-6 sm:p-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted"><Tx>Manufacturer</Tx></dt>
            <dd className="text-ink">{assignment.manufacturer ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted"><Tx>Model</Tx></dt>
            <dd className="text-ink">{assignment.model ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted"><Tx>Serial / tag</Tx></dt>
            <dd className="text-ink">{assignment.serial_tag ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted"><Tx>Location</Tx></dt>
            <dd className="text-ink">{formatLocationForDisplay(assignment.location)}</dd>
          </div>
        </dl>
      </div>

      <div className="sticky top-[calc(var(--header-h)+env(safe-area-inset-top))] z-10 -mx-3 mt-6 border-b border-border bg-background/95 px-3 backdrop-blur sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        <div role="tablist" aria-label="Assignment sections" className="flex snap-x gap-1 overflow-x-auto whitespace-nowrap">
          {TABS.map((tab) => {
            const count = tabCounts[tab.key];
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`assignment-tab-${tab.key}`}
                aria-selected={activeTab === tab.key}
                aria-controls="assignment-tab-panel"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "-mb-px inline-flex min-h-12 shrink-0 snap-start items-center gap-2 rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "border-burgundy bg-surface text-burgundy"
                    : "border-transparent text-muted hover:text-ink"
                )}
              >
                {tab.label}
                {count !== null && (
                  <span className={cn("rounded-full px-2 text-xs font-semibold tabular-nums leading-5", activeTab === tab.key ? "bg-brand-soft text-brand" : "bg-surface-sunken text-muted")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id="assignment-tab-panel" aria-labelledby={`assignment-tab-${activeTab}`} className="rounded-b-lg border border-border bg-surface shadow-xs">
        {activeTab === "measurements" && (
          <div>
            <div className="px-4 py-2">
              <ResponsiveTable
                breakpoint="md"
                caption="Measurements"
                rows={measurements}
                rowKey={(m) => m.id}
                empty={<Tx>No measurements recorded yet.</Tx>}
                columns={[
                  { key: "description", header: <Tx>Description</Tx>, cardLabel: null, tdClassName: "text-ink font-medium", render: (m) => m.description },
                  { key: "nominal", header: <Tx>Nominal</Tx>, cardLabel: "Nominal", tdClassName: "text-muted", render: (m) => m.nominal_value ?? "—" },
                  { key: "tolerance", header: <Tx>Tolerance</Tx>, cardLabel: "Tolerance", tdClassName: "text-muted", render: (m) => m.tolerance ?? "—" },
                  { key: "actual", header: <Tx>Actual</Tx>, cardLabel: "Actual", tdClassName: "text-muted", render: (m) => m.actual_value ?? "—" },
                  { key: "unit", header: <Tx>Unit</Tx>, cardLabel: "Unit", tdClassName: "text-muted", render: (m) => m.unit ?? "—" },
                  {
                    key: "result",
                    header: <Tx>Result</Tx>,
                    cardLabel: "Result",
                    render: (m) => (m.result ? <Badge tone={MEASUREMENT_RESULT_TONE[m.result]}>{m.result === "pass" ? "Pass" : "Fail"}</Badge> : "—"),
                  },
                  ...(canEdit
                    ? [
                        {
                          key: "actions",
                          header: <Tx>Actions</Tx>,
                          srOnlyHeader: true,
                          cardLabel: null,
                          className: "text-end",
                          render: (m: (typeof measurements)[number]) => (
                            <form
                              action={deleteMeasurementAction}
                              onSubmit={gateSubmit({ title: "Delete this measurement?", confirmLabel: "Delete", destructive: true })}
                            >
                              <input type="hidden" name="assignment_id" value={assignment.id} />
                              <input type="hidden" name="measurement_id" value={m.id} />
                              <Button type="submit" variant="link-danger" size="sm">
                                <Tx>Delete</Tx>
                              </Button>
                            </form>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
            {canEdit && <SuggestMeasurements assignmentId={assignment.id} />}
            {canEdit && <AddMeasurementForm assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "photos" && (
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((photo) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  url={photoSignedUrls.get(photo.storage_path) ?? null}
                  assignmentId={assignment.id}
                  canDelete={canAddEvidence}
                />
              ))}
              {photos.length === 0 && <p className="col-span-full text-center text-sm text-muted"><Tx>No photos uploaded yet.</Tx></p>}
            </div>
            {canAddEvidence && <PhotoUpload assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "evidence_documents" && (
          <AssignmentEvidenceDocuments
            assignmentId={assignment.id}
            documents={evidenceDocuments}
            vaultDocuments={vaultDocuments}
            projectId={projectId}
            vaultFolders={vaultFolders}
            canEdit={canAddEvidence}
          />
        )}

        {activeTab === "punch_list" && (
          <div>
            <div className="px-4 py-2">
              <ResponsiveTable
                breakpoint="md"
                caption="Punch list"
                rows={punchItems}
                rowKey={(item) => item.id}
                empty={<Tx>No punch list items yet.</Tx>}
                columns={[
                  { key: "description", header: <Tx>Description</Tx>, cardLabel: null, tdClassName: "text-ink font-medium", render: (item) => item.description },
                  {
                    key: "status",
                    header: <Tx>Status</Tx>,
                    cardLabel: "Status",
                    render: (item) => <Badge showIcon tone={PUNCH_STATUS_TONE[item.status]}>{item.status === "open" ? "Open" : "Closed"}</Badge>,
                  },
                  ...(canEditPunch
                    ? [
                        {
                          key: "actions",
                          header: <Tx>Actions</Tx>,
                          srOnlyHeader: true,
                          cardLabel: null,
                          className: "text-end",
                          render: (item: (typeof punchItems)[number]) => (
                            <PunchToggleButton assignmentId={assignment.id} punchItemId={item.id} status={item.status} canClose={canClose} />
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </div>
            {canEditPunch && <AddPunchItemForm assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "signatures" && (
          <div className="p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {signatures.map((sig) => (
                <div key={sig.id} className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium text-ink">
                    {sig.signatory_name} <span className="text-muted">— {sig.role}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    <Tx>Signed</Tx> {new Date(sig.signed_at).toLocaleString("en-GB")}
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sig.signature_data} alt={`Signature of ${sig.signatory_name}`} className="mt-2 h-24 w-full rounded bg-off-white object-contain" />
                  {canEdit && (
                    <form
                      action={deleteSignatureAction}
                      onSubmit={gateSubmit({ title: "Delete this signature?", confirmLabel: "Delete", destructive: true })}
                    >
                      <input type="hidden" name="assignment_id" value={assignment.id} />
                      <input type="hidden" name="signature_id" value={sig.id} />
                      <Button type="submit" variant="link-danger" size="sm" className="mt-1">
                        <Tx>Delete</Tx>
                      </Button>
                    </form>
                  )}
                </div>
              ))}
              {signatures.length === 0 && <p className="col-span-full text-center text-sm text-muted"><Tx>No signatures captured yet.</Tx></p>}
            </div>
            {canEdit && <SignaturePad assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "notes" && (
          <div className="p-4">
            <NotesForm assignmentId={assignment.id} notes={assignment.notes} readOnly={!canEdit} />
          </div>
        )}
      </div>

      {isDraft && canEdit && (
        <div className="mt-6">
          <FinalizeForm assignmentId={assignment.id} hasSignature={signatures.length > 0} />
        </div>
      )}
      {isDraft && !canEdit && (
        <p className="mt-6 text-sm text-muted"><Tx>This assignment is still in progress — someone with access to run it will finalize it.</Tx></p>
      )}
      {isConditionalOpen && canManage && canClose && (
        <div className="mt-6">
          <IssueClearanceForm assignmentId={assignment.id} canClear={clearanceBlockedCount === 0} />
        </div>
      )}
      {isConditionalOpen && !(canManage && canClose) && (
        <p className="mt-6 text-sm text-muted">
          <Tx>Conditionally passed — someone allowed to close punch items will issue clearance once the linked punch item(s) are closed.</Tx>
        </p>
      )}
      {assignment.status === "completed" && (
        <p className="mt-6 text-sm text-muted">
          <Tx>This assignment is finalized and read-only. Its conclusion was recorded as</Tx>{" "}
          <span className="font-medium text-ink">
            {assignment.conclusion ? CONCLUSION_LABEL[assignment.conclusion] : "—"}
          </span>
          .
        </p>
      )}
      {(assignment.status === "completed" || assignment.status === "conditional_open") && isAdmin && <ReopenForm assignmentId={assignment.id} />}
    </div>
  );
}

function PhotoTile({
  photo,
  url,
  assignmentId,
  canDelete,
}: {
  photo: StandaloneAssignmentPhotoRow;
  url: string | null;
  assignmentId: string;
  canDelete: boolean;
}) {
  const { gateSubmit, dialog } = useConfirm();
  return (
    <div className="rounded-md border border-border p-2">
      {dialog}
      <div className="aspect-square overflow-hidden rounded-md bg-off-white">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
          <img src={url} alt={photo.caption ?? "Assignment evidence"} className="h-full w-full object-cover" />
        ) : (
          <p className="flex h-full items-center justify-center truncate px-1 text-center text-xs text-muted" title={photo.storage_path}>
            {photo.storage_path.split("/").pop()}
          </p>
        )}
      </div>
      {photo.caption && <p className="mt-1 truncate text-sm text-ink" title={photo.caption}>{photo.caption}</p>}
      {canDelete && (
        <form
          action={deletePhotoAction}
          onSubmit={gateSubmit({ title: "Delete this photo?", confirmLabel: "Delete", destructive: true })}
        >
          <input type="hidden" name="assignment_id" value={assignmentId} />
          <input type="hidden" name="photo_id" value={photo.id} />
          <Button type="submit" variant="link-danger" size="sm" className="mt-1">
            <Tx>Delete</Tx>
          </Button>
        </form>
      )}
    </div>
  );
}
