"use client";

import { RaiseNcrDrawer } from "./raise-ncr-drawer";
import { useState, useTransition } from "react";
import Link from "next/link";
import { saveChecklistResponseAction } from "@/lib/checklists/actions";
import type { ChecklistResponseResult } from "@/lib/checklists/db-types";
import type { RegisterVerificationResult } from "@/lib/registers/verify";
import { cn } from "@/lib/cn";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { ItemPhotoUpload } from "./item-photo-upload";

const PILLS: { value: ChecklistResponseResult; label: string; activeClass: string }[] = [
  { value: "yes", label: "Yes", activeClass: "bg-success text-white border-success" },
  { value: "no", label: "No", activeClass: "bg-danger text-white border-danger" },
  { value: "na", label: "N/A", activeClass: "bg-muted text-white border-muted" },
];

// Register overrides are stored inline in checklist_responses.comment (a minimal-schema-footprint
// choice, see registers/verify.ts and this task's spec) rather than a new column, using this fixed
// prefix so it can be told apart from the inspector's own free-text comment on redisplay.
const OVERRIDE_PREFIX = "[Register override] ";

/** Splits a stored comment back into { overrideReason, comment } using the OVERRIDE_PREFIX marker. */
function splitStoredComment(stored: string): { overrideReason: string; comment: string } {
  if (!stored.startsWith(OVERRIDE_PREFIX)) return { overrideReason: "", comment: stored };
  const rest = stored.slice(OVERRIDE_PREFIX.length);
  const newlineIndex = rest.indexOf("\n");
  if (newlineIndex === -1) return { overrideReason: rest, comment: "" };
  return { overrideReason: rest.slice(0, newlineIndex), comment: rest.slice(newlineIndex + 1) };
}

function combineStoredComment(overrideReason: string, comment: string): string {
  if (!overrideReason.trim()) return comment;
  return `${OVERRIDE_PREFIX}${overrideReason.trim()}${comment ? `\n${comment}` : ""}`;
}

/**
 * One checklist item in the field-execution view: large touch-target Yes/No/N-A pills (not a
 * <select> — this is meant to be usable one-handed on a tablet) plus a comment textarea, auto-
 * saved on every change via saveChecklistResponseAction (same "no separate save step" pattern as
 * the ITP intervention grid).
 */
export function ResponseRow({
  templateId,
  inspectionRecordId,
  checklistItemId,
  itemNumber,
  description,
  isMandatory,
  initialResult,
  initialComment,
  initialCalibrationAssetId,
  readOnly,
  registerVerification,
  personnelCertVerification,
  calibrationOptions,
  initialMaterialId,
  initialWelderId,
  materialOptions,
  welderOptions,
  onResultChange,
  onSavingChange,
  projectId,
  itpItemId,
  photos,
}: {
  templateId: string;
  inspectionRecordId: string;
  checklistItemId: string;
  itemNumber: string;
  description: string;
  /** The parent ITP activity — needed to pre-fill a real "Raise NCR" link right at the point of
   *  failure (R45), rather than just hinting that one could be raised later. */
  itpItemId: string;
  isMandatory: boolean;
  initialResult: ChecklistResponseResult | null;
  initialComment: string;
  /** The calibration_register row previously recorded as "the instrument used" for this response,
   *  if any — see calibrationOptions below. */
  initialCalibrationAssetId: string | null;
  readOnly: boolean;
  /** R92-R100 register-fed auto-verification for this item's activity, or null if not applicable. */
  registerVerification: RegisterVerificationResult | null;
  /** R92-R100 personnel-cert soft-stop for whichever project_party the current signed-in user is on
   *  this activity — independent of registerVerification above (see registers/verify.ts), or null
   *  when not applicable / the user has no project_party link here. */
  personnelCertVerification: RegisterVerificationResult | null;
  /** Every calibration_register row for this project — rendered as a "which instrument did you use"
   *  picker only when registerVerification?.kind === "calibration"; ignored otherwise. */
  calibrationOptions: { id: string; instrument_name: string; cert_number: string; status: string }[];
  initialMaterialId: string | null;
  initialWelderId: string | null;
  /** Released material rows — "Material used (heat/batch)" picker when registerVerification.kind === "material". */
  materialOptions: { id: string; material_description: string; heat_number: string | null; batch_number: string | null }[];
  /** Welder rows — "Welder" picker when registerVerification.kind === "welder". */
  welderOptions: { id: string; welder_identifier: string; qualified_wps: string; status: string }[];
  /** Notifies the parent progress header immediately on tap, ahead of the save round trip. */
  onResultChange?: (result: ChecklistResponseResult | null) => void;
  /** Feeds the persistent sync-status indicator in the panel header — one row saving is enough to
   *  show "Saving…" for the whole checklist, so the parent just needs true/false per row. */
  onSavingChange?: (saving: boolean) => void;
  /** Needed to build the item-linked photo's storage path (project_id/inspection_record_id/item-…). */
  projectId: string;
  /** This item's own evidence photos (checklist_item_id === checklistItemId), for the compact
   *  per-row "+ photo" affordance below the pills. */
  photos: { id: string; storage_path: string; caption: string | null; url: string | null }[];
}) {
  const initialSplit = splitStoredComment(initialComment);
  const [result, setResult] = useState<ChecklistResponseResult | null>(initialResult);
  const [comment, setComment] = useState(initialSplit.comment);
  const [overrideReason, setOverrideReason] = useState(initialSplit.overrideReason);
  const [calibrationAssetId, setCalibrationAssetId] = useState(initialCalibrationAssetId ?? "");
  const [materialId, setMaterialId] = useState(initialMaterialId ?? "");
  const [welderId, setWelderId] = useState(initialWelderId ?? "");
  const [, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const showCalibrationPicker = registerVerification?.kind === "calibration" && calibrationOptions.length > 0;
  const showMaterialPicker = registerVerification?.kind === "material" && materialOptions.length > 0;
  const showWelderPicker = registerVerification?.kind === "welder" && welderOptions.length > 0;
  const chosenCalibration = calibrationOptions.find((o) => o.id === calibrationAssetId);
  const chosenWelder = welderOptions.find((o) => o.id === welderId);

  // R99: a register mismatch/not-found is a soft-stop — it never blocks recording a response
  // outright, but does require the inspector to type a short reason before the Yes/No/N-A buttons
  // become usable for this item. Both checks share one override-reason input: either warning is
  // enough to require it, and typing one reason satisfies both (there's no need to make the
  // inspector justify each warning separately).
  const registerNeedsOverride = registerVerification?.tone === "warning" && registerVerification.requiresOverrideReason;
  const personnelCertNeedsOverride =
    personnelCertVerification?.tone === "warning" && personnelCertVerification.requiresOverrideReason;
  const needsOverrideReason = registerNeedsOverride || personnelCertNeedsOverride;
  const overrideSatisfied = !needsOverrideReason || overrideReason.trim().length > 0;

  function save(
    nextResult: ChecklistResponseResult | null,
    nextComment: string,
    nextOverrideReason: string,
    nextCalibrationAssetId: string,
    nextMaterialId: string = materialId,
    nextWelderId: string = welderId
  ) {
    if (readOnly || !nextResult) return;
    if (needsOverrideReason && !nextOverrideReason.trim()) return;
    // R45: "a No requires a comment" — the pill click itself can't carry a comment yet, so this
    // simply defers the save until the comment field's onBlur re-calls save() with real text; the
    // "No" selection still shows locally (setResult already ran) so the inspector sees it's pending.
    if (nextResult === "no" && !nextComment.trim()) return;
    const formData = new FormData();
    formData.set("template_id", templateId);
    formData.set("inspection_record_id", inspectionRecordId);
    formData.set("checklist_item_id", checklistItemId);
    formData.set("result", nextResult);
    formData.set("comment", combineStoredComment(nextOverrideReason, nextComment));
    if (nextCalibrationAssetId) formData.set("calibration_asset_id", nextCalibrationAssetId);
    if (nextMaterialId) formData.set("material_id", nextMaterialId);
    if (nextWelderId) formData.set("welder_id", nextWelderId);

    setSaveError(null);
    onSavingChange?.(true);
    startTransition(async () => {
      try {
        // Offline (R60): rather than let the Server Action's own fetch fail, queue the response
        // right away when we already know there's no connection, and fall back to the queue if a
        // "we thought we were online" attempt fails too (a dropped connection mid-save).
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          await enqueueOutboxItem({ kind: "checklist_response", fields: Object.fromEntries(formData) as Record<string, string> });
          notifyOutboxChanged();
          return;
        }
        try {
          const outcome = await saveChecklistResponseAction(formData);
          if (outcome.error) setSaveError(outcome.error);
        } catch {
          await enqueueOutboxItem({ kind: "checklist_response", fields: Object.fromEntries(formData) as Record<string, string> });
          notifyOutboxChanged();
        }
      } finally {
        onSavingChange?.(false);
      }
    });
  }

  return (
    <div className="border-b border-border p-4 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">
            <span className="doc-id text-muted">{itemNumber}.</span> {description}
            {isMandatory && <span className="ml-1 text-danger">*</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {registerVerification && (
          <p
            className={cn(
              "rounded-md px-3 py-2 text-xs",
              registerVerification.tone === "warning" ? "bg-warning/10 text-warning" : "bg-info/10 text-info"
            )}
          >
            {registerVerification.tone === "warning" ? "⚠ " : ""}
            {registerVerification.message}
          </p>
        )}

        {personnelCertVerification && (
          <p
            className={cn(
              "rounded-md px-3 py-2 text-xs",
              personnelCertVerification.tone === "warning" ? "bg-warning/10 text-warning" : "bg-info/10 text-info"
            )}
          >
            {personnelCertVerification.tone === "warning" ? "⚠ " : ""}
            {personnelCertVerification.message}
          </p>
        )}

        {needsOverrideReason && (
          <div>
            <label htmlFor={`override-reason-${checklistItemId}`} className="sr-only">
              Reason to proceed despite the register warning for item {itemNumber}
            </label>
            <input
              id={`override-reason-${checklistItemId}`}
              type="text"
              disabled={readOnly}
              defaultValue={overrideReason}
              placeholder="Reason to proceed despite the register warning above (required)"
              onBlur={(e) => {
                setOverrideReason(e.target.value);
                save(result, comment, e.target.value, calibrationAssetId);
              }}
              className="w-full rounded-md border border-warning/40 bg-surface px-3 py-2 text-sm outline-none focus:border-warning disabled:opacity-60"
            />
          </div>
        )}

        {showCalibrationPicker && (
          <div>
            <label htmlFor={`calibration-asset-${checklistItemId}`} className="block text-xs font-medium text-ink">
              Instrument used for this measurement
            </label>
            <select
              id={`calibration-asset-${checklistItemId}`}
              disabled={readOnly}
              value={calibrationAssetId}
              onChange={(e) => {
                setCalibrationAssetId(e.target.value);
                save(result, comment, overrideReason, e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy disabled:opacity-60"
            >
              <option value="">— Not recorded —</option>
              {calibrationOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.instrument_name} (cert {opt.cert_number}){opt.status === "expired" ? " — EXPIRED" : ""}
                </option>
              ))}
            </select>
            {chosenCalibration?.status === "expired" && (
              <p className="mt-1 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                ⚠ Calibration expired — {chosenCalibration.instrument_name} (cert {chosenCalibration.cert_number}). It
                cannot be recorded as the instrument used.
              </p>
            )}
          </div>
        )}

        {showMaterialPicker && (
          <div>
            <label htmlFor={`material-${checklistItemId}`} className="block text-xs font-medium text-ink">
              Material used (heat/batch)
            </label>
            <select
              id={`material-${checklistItemId}`}
              disabled={readOnly}
              value={materialId}
              onChange={(e) => {
                setMaterialId(e.target.value);
                save(result, comment, overrideReason, calibrationAssetId, e.target.value, welderId);
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy disabled:opacity-60"
            >
              <option value="">— Not recorded —</option>
              {materialOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.material_description}
                  {opt.heat_number ? ` — heat ${opt.heat_number}` : ""}
                  {opt.batch_number ? ` — batch ${opt.batch_number}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {showWelderPicker && (
          <div>
            <label htmlFor={`welder-${checklistItemId}`} className="block text-xs font-medium text-ink">
              Welder
            </label>
            <select
              id={`welder-${checklistItemId}`}
              disabled={readOnly}
              value={welderId}
              onChange={(e) => {
                setWelderId(e.target.value);
                save(result, comment, overrideReason, calibrationAssetId, materialId, e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy disabled:opacity-60"
            >
              <option value="">— Not recorded —</option>
              {welderOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.welder_identifier} ({opt.qualified_wps}){opt.status === "expired" ? " — EXPIRED" : ""}
                </option>
              ))}
            </select>
            {chosenWelder?.status === "expired" && (
              <p className="mt-1 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                ⚠ Welder qualification expired — {chosenWelder.welder_identifier} on {chosenWelder.qualified_wps}. It
                cannot be recorded for this response.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2" role="radiogroup" aria-label={`Result for item ${itemNumber}`}>
          {PILLS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              role="radio"
              aria-checked={result === pill.value}
              disabled={readOnly || !overrideSatisfied}
              title={!overrideSatisfied ? "Enter a reason above before recording a response." : undefined}
              onClick={() => {
                setResult(pill.value);
                onResultChange?.(pill.value);
                save(pill.value, comment, overrideReason, calibrationAssetId);
              }}
              className={cn(
                "min-w-24 rounded-lg border-2 px-6 py-4 text-base font-bold transition-colors disabled:opacity-60",
                result === pill.value ? pill.activeClass : "border-border bg-surface text-ink hover:bg-off-white"
              )}
            >
              {result === pill.value && <span aria-hidden="true">✓ </span>}
              {pill.label}
            </button>
          ))}
        </div>

        {result === "no" && !comment.trim() && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            Marked as No — add a comment below to save this response (required).
          </p>
        )}
        {result === "no" && comment.trim() && (
          <p className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            <span>Marked as No.</span>
            <RaiseNcrDrawer
              projectId={projectId}
              itpItemId={itpItemId}
              inspectionRecordId={inspectionRecordId}
              initialDescription={`${itemNumber} ${description}: ${comment.trim()}`}
            />
          </p>
        )}

        <ItemPhotoUpload
          projectId={projectId}
          inspectionRecordId={inspectionRecordId}
          checklistItemId={checklistItemId}
          photos={photos}
          readOnly={readOnly}
        />

        <label htmlFor={`comment-${checklistItemId}`} className="sr-only">
          Comment for item {itemNumber}
        </label>
        <textarea
          id={`comment-${checklistItemId}`}
          rows={2}
          disabled={readOnly}
          defaultValue={comment}
          placeholder="Comment (optional)"
          onBlur={(e) => {
            setComment(e.target.value);
            save(result, e.target.value, overrideReason, calibrationAssetId);
          }}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
        {saveError && <p className="text-xs text-danger">{saveError}</p>}
      </div>
    </div>
  );
}
