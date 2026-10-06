"use client";
import { formatLocationForDisplay } from "@/lib/checklists/location";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
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
import { togglePunchItemAction } from "@/lib/standalone/actions";
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
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("measurements");
  const isDraft = assignment.status === "draft";
  const isConditionalOpen = assignment.status === "conditional_open";
  // Distinct from isDraft: isDraft is about the assignment's actual state (still correct to show
  // as "Draft" to anyone), canEdit is about whether THIS viewer may mutate it. Every action this
  // gates is permission-checked server-side (lib/standalone/actions.ts) — this just stops the
  // controls from rendering for a party who'd only find that out after clicking submit.
  const canEdit = isDraft && canManage;
  const canEditPunch = (isDraft || isConditionalOpen) && canManage;
  const openPunchCount = punchItems.filter((p) => p.status === "open").length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Measurements" value={measurements.length} />
        <StatCard label="Photos" value={photos.length} />
        <StatCard label="Open punch items" value={openPunchCount} />
        <StatCard
          label="Status"
          value={
            isDraft ? (
              <Badge tone="neutral">Draft</Badge>
            ) : (
              <Badge tone={assignment.conclusion ? CONCLUSION_TONE[assignment.conclusion] : "neutral"}>
                {assignment.conclusion ? CONCLUSION_LABEL[assignment.conclusion] : "Completed"}
                {isConditionalOpen ? " (awaiting clearance)" : ""}
              </Badge>
            )
          }
        />
      </div>

      {isConditionalOpen && (
        <div className="mt-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          <p className="font-medium">
            {linkedTotalPunchCount - linkedOpenPunchCount} of {linkedTotalPunchCount} linked punch items closed
            {linkedOpenPunchCount > 0 ? " — clearance blocked" : " — ready to issue clearance"}
          </p>
          <p className="mt-0.5 text-warning/90">
            {linkedOpenPunchCount > 0
              ? "This assignment stays conditionally open until every linked punch item on the project punch list is closed."
              : "All linked punch items are closed. Issue clearance below to complete this assignment."}
          </p>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">Manufacturer</dt>
            <dd className="text-ink">{assignment.manufacturer ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Model</dt>
            <dd className="text-ink">{assignment.model ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Serial / tag</dt>
            <dd className="text-ink">{assignment.serial_tag ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Location</dt>
            <dd className="text-ink">{formatLocationForDisplay(assignment.location)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 border-b border-border">
        <nav className="flex gap-1 overflow-x-auto whitespace-nowrap">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "border-burgundy bg-surface text-burgundy"
                  : "border-transparent text-muted hover:text-ink"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="rounded-b-lg border border-border bg-surface">
        {activeTab === "measurements" && (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Nominal</th>
                    <th className="px-3 py-2 font-medium">Tolerance</th>
                    <th className="px-3 py-2 font-medium">Actual</th>
                    <th className="px-3 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {measurements.map((m) => (
                    <tr key={m.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{m.description}</td>
                      <td className="px-3 py-2 text-muted">{m.nominal_value ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{m.tolerance ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{m.actual_value ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{m.unit ?? "—"}</td>
                      <td className="px-3 py-2">
                        {m.result ? (
                          <Badge tone={MEASUREMENT_RESULT_TONE[m.result]}>{m.result === "pass" ? "Pass" : "Fail"}</Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {measurements.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted">
                        No measurements recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canEdit && <SuggestMeasurements assignmentId={assignment.id} />}
            {canEdit && <AddMeasurementForm assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "photos" && (
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((photo) => (
                <PhotoTile key={photo.id} photo={photo} url={photoSignedUrls.get(photo.storage_path) ?? null} />
              ))}
              {photos.length === 0 && <p className="col-span-full text-center text-sm text-muted">No photos uploaded yet.</p>}
            </div>
            {canEdit && <PhotoUpload assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "evidence_documents" && (
          <AssignmentEvidenceDocuments
            assignmentId={assignment.id}
            documents={evidenceDocuments}
            vaultDocuments={vaultDocuments}
            projectId={projectId}
            vaultFolders={vaultFolders}
            canEdit={canEdit}
          />
        )}

        {activeTab === "punch_list" && (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    {canEditPunch && <th className="px-3 py-2 font-medium">&nbsp;</th>}
                  </tr>
                </thead>
                <tbody>
                  {punchItems.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{item.description}</td>
                      <td className="px-3 py-2">
                        <Badge tone={PUNCH_STATUS_TONE[item.status]}>{item.status === "open" ? "Open" : "Closed"}</Badge>
                      </td>
                      {canEditPunch && (
                        <td className="px-3 py-2 text-right">
                          <form action={togglePunchItemAction}>
                            <input type="hidden" name="assignment_id" value={assignment.id} />
                            <input type="hidden" name="punch_item_id" value={item.id} />
                            <input type="hidden" name="current_status" value={item.status} />
                            <button
                              type="submit"
                              className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-off-white"
                            >
                              Mark {item.status === "open" ? "closed" : "open"}
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                  {punchItems.length === 0 && (
                    <tr>
                      <td colSpan={canEditPunch ? 3 : 2} className="px-3 py-6 text-center text-muted">
                        No punch list items yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
                    Signed {new Date(sig.signed_at).toLocaleString("en-GB")}
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sig.signature_data} alt={`Signature of ${sig.signatory_name}`} className="mt-2 h-24 w-full rounded bg-off-white object-contain" />
                </div>
              ))}
              {signatures.length === 0 && <p className="col-span-full text-center text-sm text-muted">No signatures captured yet.</p>}
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
        <p className="mt-6 text-sm text-muted">This assignment is still in progress — someone with access to run it will finalize it.</p>
      )}
      {isConditionalOpen && canManage && (
        <div className="mt-6">
          <IssueClearanceForm assignmentId={assignment.id} canClear={linkedOpenPunchCount === 0} />
        </div>
      )}
      {isConditionalOpen && !canManage && (
        <p className="mt-6 text-sm text-muted">
          Conditionally passed — someone with access to run it will issue clearance once the linked punch item(s) are closed.
        </p>
      )}
      {assignment.status === "completed" && (
        <p className="mt-6 text-sm text-muted">
          This assignment is finalized and read-only. Its conclusion was recorded as{" "}
          <span className="font-medium text-ink">
            {assignment.conclusion ? CONCLUSION_LABEL[assignment.conclusion] : "—"}
          </span>
          .
        </p>
      )}
    </div>
  );
}

function PhotoTile({ photo, url }: { photo: StandaloneAssignmentPhotoRow; url: string | null }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="aspect-square overflow-hidden rounded-md bg-off-white">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, not a static asset
          <img src={url} alt={photo.caption ?? "Assignment evidence"} className="h-full w-full object-cover" />
        ) : (
          <p className="flex h-full items-center justify-center truncate px-1 text-center text-[10px] text-muted" title={photo.storage_path}>
            {photo.storage_path.split("/").pop()}
          </p>
        )}
      </div>
      {photo.caption && <p className="mt-1 truncate text-sm text-ink" title={photo.caption}>{photo.caption}</p>}
    </div>
  );
}
