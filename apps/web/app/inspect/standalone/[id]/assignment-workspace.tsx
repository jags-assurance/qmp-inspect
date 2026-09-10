"use client";

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
import { AddPunchItemForm } from "./add-punch-item-form";
import { PhotoUpload } from "./photo-upload";
import { SignaturePad } from "./signature-pad";
import { NotesForm } from "./notes-form";
import { FinalizeForm } from "./finalize-form";

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
  punchItems,
  signatures,
}: {
  assignment: Assignment;
  measurements: StandaloneAssignmentMeasurementRow[];
  photos: StandaloneAssignmentPhotoRow[];
  punchItems: StandaloneAssignmentPunchItemRow[];
  signatures: StandaloneAssignmentSignatureRow[];
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("measurements");
  const isDraft = assignment.status === "draft";
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
              </Badge>
            )
          }
        />
      </div>

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
            <dd className="text-ink">{assignment.location ?? "—"}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 border-b border-border">
        <nav className="flex flex-wrap gap-1">
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
            {isDraft && <AddMeasurementForm assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "photos" && (
          <div className="p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {photos.map((photo) => (
                <PhotoTile key={photo.id} photo={photo} />
              ))}
              {photos.length === 0 && <p className="col-span-full text-center text-sm text-muted">No photos uploaded yet.</p>}
            </div>
            {isDraft && <PhotoUpload assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "punch_list" && (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    {isDraft && <th className="px-3 py-2 font-medium">&nbsp;</th>}
                  </tr>
                </thead>
                <tbody>
                  {punchItems.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{item.description}</td>
                      <td className="px-3 py-2">
                        <Badge tone={PUNCH_STATUS_TONE[item.status]}>{item.status === "open" ? "Open" : "Closed"}</Badge>
                      </td>
                      {isDraft && (
                        <td className="px-3 py-2">
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
                      <td colSpan={isDraft ? 3 : 2} className="px-3 py-6 text-center text-muted">
                        No punch list items yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {isDraft && <AddPunchItemForm assignmentId={assignment.id} />}
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
                    Signed {new Date(sig.signed_at).toLocaleString()}
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sig.signature_data} alt={`Signature of ${sig.signatory_name}`} className="mt-2 h-24 w-full rounded bg-off-white object-contain" />
                </div>
              ))}
              {signatures.length === 0 && <p className="col-span-full text-center text-sm text-muted">No signatures captured yet.</p>}
            </div>
            {isDraft && <SignaturePad assignmentId={assignment.id} />}
          </div>
        )}

        {activeTab === "notes" && (
          <div className="p-4">
            <NotesForm assignmentId={assignment.id} notes={assignment.notes} readOnly={!isDraft} />
          </div>
        )}
      </div>

      {isDraft ? (
        <div className="mt-6">
          <FinalizeForm assignmentId={assignment.id} />
        </div>
      ) : (
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

function PhotoTile({ photo }: { photo: StandaloneAssignmentPhotoRow }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="truncate text-xs text-muted" title={photo.storage_path}>
        {photo.storage_path.split("/").pop()}
      </p>
      {photo.caption && <p className="mt-1 text-sm text-ink">{photo.caption}</p>}
    </div>
  );
}
