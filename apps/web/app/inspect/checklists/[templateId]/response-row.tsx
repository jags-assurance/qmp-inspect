"use client";

import { RaiseNcrDrawer } from "./raise-ncr-drawer";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { saveChecklistResponseAction } from "@/lib/checklists/actions";
import type { ChecklistResponseResult } from "@/lib/checklists/db-types";
import type { RegisterVerificationResult } from "@/lib/registers/verify";
import { cn } from "@/lib/cn";
import { enqueueOutboxItem, hasQueuedAnswerFor } from "@/lib/offline/db";
import { notifyOutboxChanged, RESPONSE_SYNCED_EVENT, type ResponseSyncedDetail } from "@/lib/offline/sync-client";
import { ItemPhotoUpload } from "./item-photo-upload";
import { FixAssigneeForm } from "./fix-assignee-form";
import { evidenceRequirementHint } from "@/lib/checklists/evidence-rules";
import { describeSpec, evaluateNumeric, parseNumericInput, type NumericSpec } from "@/lib/checklists/numeric-response";
import { ItemDocuments, type ItemLinkedDocument } from "./item-documents";
import type { VaultPickerDocument } from "@/components/domain/vault-file-picker";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  initialUpdatedAt,
  initialNoNcrReason,
  hasNcr,
  materialOptions,
  welderOptions,
  onResultChange,
  onSavingChange,
  projectId,
  itpItemId,
  photos,
  itemDocuments = [],
  vaultOptions = [],
  vaultFolders = [],
  numeric = null,
  initialNumericValue = null,
  fixAssigneeId = null,
  fixAssigneeName = null,
  fixOptions = [],
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
  /** The answer row's updated_at when this page loaded (null = no row yet) — concurrent-edit baseline. */
  initialUpdatedAt?: string | null;
  initialNoNcrReason?: string | null;
  /** An NCR/observation already exists on this inspection (a "No" then needs no separate reason). */
  hasNcr?: boolean;
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
  /** Documents linked to this item, and approved vault files available to link. */
  itemDocuments?: ItemLinkedDocument[];
  vaultOptions?: VaultPickerDocument[];
  vaultFolders?: import("@/components/domain/vault-file-picker").VaultPickerFolder[];
  /** S4-20: set for a measured item: the inspector types a number and the limits decide the result. */
  numeric?: NumericSpec | null;
  initialNumericValue?: number | null;
  /** Who was named to fix this item (when answered No), their display name, and who can be picked. */
  fixAssigneeId?: string | null;
  fixAssigneeName?: string | null;
  fixOptions?: { id: string; name: string }[];
}) {
  const tl = useTranslate();
  const initialSplit = splitStoredComment(initialComment);
  const [result, setResult] = useState<ChecklistResponseResult | null>(initialResult);
  const [comment, setComment] = useState(initialSplit.comment);
  const [overrideReason, setOverrideReason] = useState(initialSplit.overrideReason);
  const [calibrationAssetId, setCalibrationAssetId] = useState(initialCalibrationAssetId ?? "");
  const [materialId, setMaterialId] = useState(initialMaterialId ?? "");
  const [welderId, setWelderId] = useState(initialWelderId ?? "");
  const [, startTransition] = useTransition();
  const saveSeq = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const lastPayload = useRef<{
    nextResult: ChecklistResponseResult;
    nextComment: string;
    nextOverrideReason: string;
    nextCalibrationAssetId: string;
    nextMaterialId: string;
    nextWelderId: string;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [noNcrReason, setNoNcrReason] = useState(initialNoNcrReason ?? "");
  const [numericText, setNumericText] = useState(initialNumericValue === null ? "" : String(initialNumericValue));
  // The latest typed reading, read inside save() (state would be one render stale when save runs from the same event).
  const numericRef = useRef(numericText);
  // Baseline for concurrent-edit detection: "none" = no row existed when we loaded.
  const expectedUpdatedAt = useRef<string>(initialUpdatedAt ?? "none");
  // A queued answer for this item synced in the background: adopt its server timestamp as the baseline.
  useEffect(() => {
    const onSynced = (e: Event) => {
      const d = (e as CustomEvent<ResponseSyncedDetail>).detail;
      if (d?.inspectionRecordId === inspectionRecordId && d.checklistItemId === checklistItemId) {
        expectedUpdatedAt.current = d.updatedAt;
      }
    };
    window.addEventListener(RESPONSE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(RESPONSE_SYNCED_EVENT, onSynced);
  }, [inspectionRecordId, checklistItemId]);
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
    nextWelderId: string = welderId,
    nextNoNcrReason: string = noNcrReason
  ) {
    if (readOnly || !nextResult) return;
    if (needsOverrideReason && !nextOverrideReason.trim()) {
      onResultChange?.(null);
      return;
    }
    // R45: "a No requires a comment" — the pill click itself can't carry a comment yet, so this
    // simply defers the save until the comment field's onBlur re-calls save() with real text; the
    // "No" selection still shows locally (setResult already ran) so the inspector sees it's pending.
    // Until it is actually saved it must NOT count as answered.
    if (nextResult === "no" && !nextComment.trim()) {
      onResultChange?.(null);
      return;
    }
    const formData = new FormData();
    formData.set("template_id", templateId);
    formData.set("inspection_record_id", inspectionRecordId);
    formData.set("checklist_item_id", checklistItemId);
    formData.set("result", nextResult);
    formData.set("comment", combineStoredComment(nextOverrideReason, nextComment));
    // Structured copies for the server: the override reason, and WHEN the answer was given (an offline
    // replay carries this, so registers are judged on the inspection day, not the sync day).
    if (nextOverrideReason.trim()) formData.set("override_reason", nextOverrideReason.trim());
    formData.set("captured_at", new Date().toISOString());
    if (nextCalibrationAssetId) formData.set("calibration_asset_id", nextCalibrationAssetId);
    if (nextMaterialId) formData.set("material_id", nextMaterialId);
    if (nextWelderId) formData.set("welder_id", nextWelderId);
    if (nextResult === "no" && nextNoNcrReason.trim()) formData.set("no_ncr_reason", nextNoNcrReason.trim());
    if (numeric && nextResult !== "na" && numericRef.current.trim()) formData.set("numeric_value", numericRef.current.trim());

    lastPayload.current = { nextResult, nextComment, nextOverrideReason, nextCalibrationAssetId, nextMaterialId, nextWelderId };
    setSaveError(null);
    onSavingChange?.(true);
    const mySeq = ++saveSeq.current;
    // Saves for one row run strictly in order (chained), so a slow earlier request can never land
    // after — and overwrite — a later tap (last write wins = what the inspector last chose).
    const run = async () => {
      try {
        // The server timestamp this answer is based on travels with the request AND with a queued
        // offline replay, so a conflicting change is shown for review on sync instead of overwritten.
        formData.set("expected_updated_at", expectedUpdatedAt.current);
        const fields = Object.fromEntries(formData) as Record<string, string>;
        // Offline (R60): queue right away when we already know there's no connection, and fall back
        // to the queue if a "we thought we were online" attempt throws (dropped connection mid-save).
        // Also queue while an earlier answer for this item is still waiting to sync: sent online it would
        // overtake the queued one, which would then replay against a newer server value and 409.
        if (
          (typeof navigator !== "undefined" && !navigator.onLine) ||
          (await hasQueuedAnswerFor(inspectionRecordId, checklistItemId))
        ) {
          await enqueueOutboxItem({ kind: "checklist_response", fields });
          notifyOutboxChanged();
          if (mySeq === saveSeq.current) onResultChange?.(nextResult);
          return;
        }
        try {
          const outcome = await saveChecklistResponseAction(formData);
          if (outcome.conflict) {
            setConflict(true);
            setSaveError(outcome.error);
            onResultChange?.(null);
          } else if (outcome.error) {
            if (mySeq === saveSeq.current) {
              setSaveError(outcome.error);
              onResultChange?.(null);
            }
          } else {
            if (outcome.updatedAt) expectedUpdatedAt.current = outcome.updatedAt;
            if (mySeq === saveSeq.current) onResultChange?.(nextResult);
          }
        } catch {
          await enqueueOutboxItem({ kind: "checklist_response", fields });
          notifyOutboxChanged();
          if (mySeq === saveSeq.current) onResultChange?.(nextResult);
        }
      } finally {
        onSavingChange?.(false);
      }
    };
    queueRef.current = queueRef.current.then(run, run);
    startTransition(() => {});
  }

  // A measured item: the typed number decides yes / no against the item's limits (the server repeats the
  // same check). Typing over an N/A switches the item back to measured.
  function commitNumeric(text: string) {
    if (!numeric || readOnly) return;
    numericRef.current = text;
    const value = parseNumericInput(text);
    if (value === null) return;
    const next = evaluateNumeric(value, numeric);
    setResult(next);
    save(next, comment, overrideReason, calibrationAssetId);
  }

  function retry() {
    const p = lastPayload.current;
    if (!p) return;
    save(p.nextResult, p.nextComment, p.nextOverrideReason, p.nextCalibrationAssetId, p.nextMaterialId, p.nextWelderId);
  }

  return (
    <div className="border-b border-border p-4 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">
            <span className="doc-id text-muted">{itemNumber}.</span> {description}
            {isMandatory && (
              <span className="ms-1 text-danger" title={tl("Mandatory item")}>
                * <span className="sr-only"><Tx>mandatory</Tx></span>
              </span>
            )}
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
              <Tx>Reason to proceed despite the register warning for item</Tx> {itemNumber}
            </label>
            <input
              id={`override-reason-${checklistItemId}`}
              type="text"
              disabled={readOnly}
              defaultValue={overrideReason}
              placeholder={tl("Reason to proceed despite the register warning above (required)")}
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
              <Tx>Instrument used for this measurement</Tx>
            </label>
            <select
              id={`calibration-asset-${checklistItemId}`}
              disabled={readOnly}
              value={calibrationAssetId}
              onChange={(e) => {
                setCalibrationAssetId(e.target.value);
                save(result, comment, overrideReason, e.target.value);
              }}
              className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-base outline-none sm:text-sm focus:border-burgundy disabled:opacity-60"
            >
              <option value=""><Tx>— Not recorded —</Tx></option>
              {calibrationOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.instrument_name} <Tx>(cert</Tx> {opt.cert_number}){opt.status === "expired" ? " — EXPIRED" : ""}
                </option>
              ))}
            </select>
            {chosenCalibration?.status === "expired" && (
              <p className="mt-1 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                <Tx>⚠ Calibration expired —</Tx> {chosenCalibration.instrument_name} <Tx>(cert</Tx> {chosenCalibration.cert_number}<Tx>). It cannot be recorded as the instrument used.</Tx>
              </p>
            )}
          </div>
        )}

        {showMaterialPicker && (
          <div>
            <label htmlFor={`material-${checklistItemId}`} className="block text-xs font-medium text-ink">
              <Tx>Material used (heat/batch)</Tx>
            </label>
            <select
              id={`material-${checklistItemId}`}
              disabled={readOnly}
              value={materialId}
              onChange={(e) => {
                setMaterialId(e.target.value);
                save(result, comment, overrideReason, calibrationAssetId, e.target.value, welderId);
              }}
              className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-base outline-none sm:text-sm focus:border-burgundy disabled:opacity-60"
            >
              <option value=""><Tx>— Not recorded —</Tx></option>
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
              <Tx>Welder</Tx>
            </label>
            <select
              id={`welder-${checklistItemId}`}
              disabled={readOnly}
              value={welderId}
              onChange={(e) => {
                setWelderId(e.target.value);
                save(result, comment, overrideReason, calibrationAssetId, materialId, e.target.value);
              }}
              className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-base outline-none sm:text-sm focus:border-burgundy disabled:opacity-60"
            >
              <option value=""><Tx>— Not recorded —</Tx></option>
              {welderOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.welder_identifier} ({opt.qualified_wps}){opt.status === "expired" ? " — EXPIRED" : ""}
                </option>
              ))}
            </select>
            {chosenWelder?.status === "expired" && (
              <p className="mt-1 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                <Tx>⚠ Welder qualification expired —</Tx> {chosenWelder.welder_identifier} <Tx>on</Tx> {chosenWelder.qualified_wps}<Tx>. It cannot be recorded for this response.</Tx>
              </p>
            )}
          </div>
        )}

        {numeric && (
          <div className="mb-2">
            <label htmlFor={`num-${checklistItemId}`} className="block text-xs font-medium text-muted">
              <Tx>Measured value</Tx> <span className="font-normal"><Tx>(limit:</Tx> {describeSpec(numeric)})</span>
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`num-${checklistItemId}`}
                type="text"
                inputMode="decimal"
                value={numericText}
                disabled={readOnly || !overrideSatisfied || result === "na"}
                onChange={(e) => setNumericText(e.target.value)}
                onBlur={(e) => commitNumeric(e.target.value)}
                aria-describedby={`num-hint-${checklistItemId}`}
                className="w-32 rounded-md border border-border bg-surface px-2.5 py-2 text-base outline-none focus:border-burgundy disabled:opacity-60"
              />
              {numeric.unit && <span className="text-sm text-muted">{numeric.unit}</span>}
            </div>
            <p id={`num-hint-${checklistItemId}`} className="mt-1 text-xs text-muted" aria-live="polite">
              {(() => {
                const v = parseNumericInput(numericText);
                if (v === null) return numericText.trim() ? "Enter a number." : "Type the reading to save it.";
                return evaluateNumeric(v, numeric) === "yes" ? "✓ Within the limit." : "⚠ Outside the limit: this item fails and needs a comment.";
              })()}
            </p>
          </div>
        )}

        <div className="flex gap-2" role="radiogroup" aria-label={`Result for item ${itemNumber}`}>
          {(numeric ? PILLS.filter((p) => p.value === "na") : PILLS).map((pill) => (
            <button
              key={pill.value}
              type="button"
              role="radio"
              aria-checked={result === pill.value}
              disabled={readOnly || !overrideSatisfied}
              title={!overrideSatisfied ? "Enter a reason above before recording a response." : undefined}
              onClick={() => {
                // Double-tap protection: re-tapping the already-chosen answer is a no-op unless the
                // last save failed (then it acts as a retry).
                if (result === pill.value && !saveError) return;
                setResult(pill.value);
                save(pill.value, comment, overrideReason, calibrationAssetId);
              }}
              className={cn(
                "min-h-12 min-w-0 flex-1 rounded-lg border-2 px-4 py-3 text-base font-bold transition-colors disabled:opacity-60 sm:flex-none sm:min-w-24 sm:px-6",
                result === pill.value ? pill.activeClass : "border-border bg-surface text-ink hover:bg-off-white"
              )}
            >
              {result === pill.value && <span aria-hidden="true">✓ </span>}
              {pill.label}
            </button>
          ))}
        </div>

        {(() => {
          const hint = evidenceRequirementHint(isMandatory, result, photos.length > 0 || (itemDocuments?.length ?? 0) > 0);
          if (!hint) return null;
          return (
            <p className={`text-xs ${hint.met ? "text-muted" : "text-warning"}`} role="note">
              {hint.met ? "✓ " : "⚠ "}
              {hint.text}
            </p>
          );
        })()}

        {result === "no" && !comment.trim() && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            <Tx>Add a comment to save this No.</Tx>
          </p>
        )}
        {result === "no" && comment.trim() && (
          <p className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            <span><Tx>Marked No.</Tx></span>
            <RaiseNcrDrawer
              projectId={projectId}
              itpItemId={itpItemId}
              inspectionRecordId={inspectionRecordId}
              checklistItemId={checklistItemId}
              initialDescription={`${itemNumber} ${description}: ${comment.trim()}`}
            />
          </p>
        )}
        {result === "no" && comment.trim() && (readOnly ? fixAssigneeName : true) && (
          <div className="rounded-md border border-border bg-off-white px-3 py-2">
            {readOnly ? (
              <p className="text-xs text-ink">
                <Tx>Assigned to</Tx> {fixAssigneeName}
              </p>
            ) : (
              <>
                {fixAssigneeName && (
                  <p className="mb-1 text-xs text-ink">
                    <Tx>Assigned to</Tx> {fixAssigneeName}
                  </p>
                )}
                <FixAssigneeForm
                  key={fixAssigneeId ?? "none"}
                  templateId={templateId}
                  inspectionRecordId={inspectionRecordId}
                  checklistItemId={checklistItemId}
                  currentAssigneeId={fixAssigneeId}
                  options={fixOptions}
                />
              </>
            )}
          </div>
        )}
        {result === "no" && comment.trim() && !hasNcr && (
          <div>
            <label htmlFor={`no-ncr-reason-${checklistItemId}`} className="block text-xs font-medium text-ink">
              <Tx>No NCR raised? Give a reason (needed to complete).</Tx>
            </label>
            <input
              id={`no-ncr-reason-${checklistItemId}`}
              type="text"
              disabled={readOnly}
              defaultValue={noNcrReason}
              maxLength={500}
              placeholder={tl("e.g. Rectified on the spot and re-verified")}
              onBlur={(e) => {
                if (e.target.value === noNcrReason) return;
                setNoNcrReason(e.target.value);
                save(result, comment, overrideReason, calibrationAssetId, materialId, welderId, e.target.value);
              }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy disabled:opacity-60 sm:text-sm"
            />
          </div>
        )}

        <div className="flex flex-wrap items-start gap-2">
          <ItemPhotoUpload
            projectId={projectId}
            inspectionRecordId={inspectionRecordId}
            checklistItemId={checklistItemId}
            photos={photos}
            readOnly={readOnly}
          />

          <ItemDocuments
            projectId={projectId}
            inspectionRecordId={inspectionRecordId}
            checklistItemId={checklistItemId}
            itemNumber={itemNumber}
            documents={itemDocuments}
            vaultOptions={vaultOptions}
            vaultFolders={vaultFolders}
            readOnly={readOnly}
          />
        </div>

        <details className="group" open={result === "no" || !!comment.trim()}>
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
            <Tx>Comment</Tx>
            {result === "no" && <span className="text-danger">*</span>}
          </summary>
          <label htmlFor={`comment-${checklistItemId}`} className="sr-only">
            <Tx>Comment for item</Tx> {itemNumber}
          </label>
          <textarea
            id={`comment-${checklistItemId}`}
            rows={2}
            disabled={readOnly}
            defaultValue={comment}
            maxLength={2000}
            placeholder={result === "no" ? "Comment (required for No)" : "Comment (optional)"}
            aria-required={result === "no"}
            onBlur={(e) => {
              const changed = e.target.value !== comment;
              setComment(e.target.value);
              if (changed || result === "no") save(result, e.target.value, overrideReason, calibrationAssetId);
            }}
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy disabled:opacity-60 sm:text-sm"
          />
        </details>
        {saveError && (
          <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
            <span>{saveError}</span>
            {conflict ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-11 rounded-md border border-danger px-3 font-medium text-danger hover:bg-danger/10"
              >
                <Tx>Reload</Tx>
              </button>
            ) : (
              <button
                type="button"
                onClick={retry}
                className="min-h-11 rounded-md border border-danger px-3 font-medium text-danger hover:bg-danger/10"
              >
                <Tx>Retry</Tx>
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
