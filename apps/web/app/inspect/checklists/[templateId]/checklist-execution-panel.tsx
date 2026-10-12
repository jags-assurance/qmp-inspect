"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ResponseRow } from "./response-row";
import type { NumericSpec } from "@/lib/checklists/numeric-response";
import type { ItemLinkedDocument } from "./item-documents";
import type { VaultPickerDocument } from "@/components/domain/vault-file-picker";
import type { ChecklistResponseResult } from "@/lib/checklists/db-types";
import type { RegisterVerificationResult } from "@/lib/registers/verify";
import { Tx } from "@/components/domain/tx";

interface ChecklistItem {
  id: string;
  item_number: string;
  description: string;
  is_mandatory: boolean;
  /** S4-20: limits of a measured item; null/absent for pass/fail. */
  numeric?: NumericSpec | null;
}

/**
 * Owns the "X of N answered" progress header as local state, seeded from the server-fetched
 * responses but updated the instant a pill is tapped — not on the round trip through
 * saveChecklistResponseAction + RealtimeRefresh's postgres_changes → router.refresh(), which is
 * fast but never instant, and left the header visibly stale for a beat after every tap.
 */
export function ChecklistExecutionPanel({
  templateId,
  inspectionRecordId,
  items,
  initialResponses,
  fixAssignments,
  fixOptions,
  readOnly,
  registerVerification,
  personnelCertVerification,
  calibrationOptions,
  materialOptions,
  welderOptions,
  canExecute,
  photoSlot,
  hasEvidencePhoto,
  completeSlot,
  missingPhotoSlot,
  incompleteSlot,
  projectId,
  itpItemId,
  itemPhotos,
  itemDocuments,
  vaultOptions,
  vaultFolders = [],
  hasNcr = false,
  numericValues,
}: {
  templateId: string;
  inspectionRecordId: string;
  items: ChecklistItem[];
  /** Recorded readings of measured items, by item id. */
  numericValues?: Map<string, number>;
  /** Who was named to fix each failed item (item id -> person), and who can be picked. */
  fixAssignments?: Map<string, { id: string; name: string }>;
  fixOptions?: { id: string; name: string }[];
  initialResponses: Map<string, { result: ChecklistResponseResult; comment: string | null; calibrationAssetId: string | null; materialId: string | null; welderId: string | null; updatedAt?: string | null; noNcrReason?: string | null }>;
  readOnly: boolean;
  registerVerification: RegisterVerificationResult | null;
  /** R92-R100 personnel-cert soft-stop for the executing party — independent of registerVerification
   *  above, see registers/verify.ts. */
  personnelCertVerification: RegisterVerificationResult | null;
  /** Every calibration_register row for this project, offered as a "which instrument did you use"
   *  picker on each row when registerVerification.kind === "calibration". Empty otherwise. */
  calibrationOptions: { id: string; instrument_name: string; cert_number: string; status: string }[];
  /** Released material rows, offered as "Material used (heat/batch)" when registerVerification.kind === "material". */
  materialOptions: { id: string; material_description: string; heat_number: string | null; batch_number: string | null }[];
  /** Welder rows, offered as "Welder" when registerVerification.kind === "welder". */
  welderOptions: { id: string; welder_identifier: string; qualified_wps: string; status: string }[];
  canExecute: boolean;
  /** Rendered between the response rows and the complete/incomplete slot below. */
  photoSlot: ReactNode;
  /** At least one evidence photo exists — attached to the inspection as a whole, or to any
   *  individual item — computed server-side from the same rows photoSlot itself renders. Required
   *  to complete, same as a signature (see completeInspectionCore's matching server-side check). */
  hasEvidencePhoto: boolean;
  /** Rendered once every item has a response AND at least one evidence photo exists (Complete-
   *  inspection form + consistency check). */
  completeSlot: ReactNode;
  /** Rendered once every item is answered but no evidence photo has been attached yet. */
  missingPhotoSlot: ReactNode;
  /** Rendered while items remain unanswered. */
  incompleteSlot: ReactNode;
  /** Needed to build each item-linked photo's storage path. */
  projectId: string;
  /** The parent ITP activity — threaded down to ResponseRow's "Raise NCR" link (R45). */
  itpItemId: string;
  /** Each checklist item's own evidence photos (checklist_item_id === that item's id), keyed by
   *  checklist_item_id, for the compact per-row "+ photo" affordance. */
  /** An NCR/observation already exists on this inspection. */
  hasNcr?: boolean;
  itemDocuments: Map<string, ItemLinkedDocument[]>;
  vaultOptions: VaultPickerDocument[];
  vaultFolders?: import("@/components/domain/vault-file-picker").VaultPickerFolder[];
  itemPhotos: Map<string, { id: string; storage_path: string; caption: string | null; url: string | null }[]>;
}) {
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set(initialResponses.keys()));
  // Round-table finding: the old per-row transient "Saving…" text disappeared the instant that one
  // row's request settled, giving no sense of overall sync state. This tracks how many rows are
  // currently in flight (not just the last one) plus real navigator.onLine, for one persistent
  // status pill instead of N flickering per-row messages.
  const [savingCount, setSavingCount] = useState(0);
  // Same hydration-safe pattern as offline-banner.tsx: default true (matches the server's render,
  // which has no `navigator`), then read the real value post-mount inside the effect.
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
    setIsOnline(navigator.onLine);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const totalCount = items.length;
  const answeredCount = answeredIds.size;
  const answeredPct = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
  // totalCount === 0 must never satisfy this — answeredCount === totalCount (0 === 0) is otherwise
  // vacuously true, which rendered a clickable Complete button for a checklist with no items even
  // though the server (validateChecklistItemsAnswered) always rejects that completion attempt.
  const allAnswered = totalCount > 0 && answeredCount === totalCount;

  const mandatoryTotal = items.filter((i) => i.is_mandatory).length;
  const mandatoryRemaining = items.filter((i) => i.is_mandatory && !answeredIds.has(i.id)).length;

  // Warn before leaving the page while a save is still in flight.
  useEffect(() => {
    if (savingCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [savingCount]);

  const syncStatus = !isOnline
    ? { label: "Offline — will sync when reconnected", className: "text-warning" }
    : savingCount > 0
      ? { label: "Saving…", className: "text-muted" }
      : { label: "All changes saved", className: "text-success" };

  return (
    <>
      {totalCount > 0 && (
        <div className="sticky top-0 z-10 -mx-1 bg-surface/95 px-1 py-2 backdrop-blur" aria-live="polite">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">
              {answeredCount} <Tx>of</Tx> {totalCount} <Tx>answered</Tx>
              {mandatoryTotal > 0 && (
                <span className={mandatoryRemaining > 0 ? "ms-2 text-danger" : "ms-2 text-success"}>
                  {mandatoryRemaining > 0 ? `${mandatoryRemaining} mandatory remaining` : "all mandatory done"}
                </span>
              )}
            </span>
            <span className="text-muted">{answeredPct}%</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-off-white">
            <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${answeredPct}%` }} />
          </div>
          {canExecute && (
            <p className={"mt-1.5 text-xs font-medium " + syncStatus.className}>{syncStatus.label}</p>
          )}
        </div>
      )}
      <div className="rounded-lg border border-border bg-surface">
        {items.map((item) => (
          <ResponseRow
            key={item.id}
            templateId={templateId}
            inspectionRecordId={inspectionRecordId}
            checklistItemId={item.id}
            itemNumber={item.item_number}
            description={item.description}
            isMandatory={item.is_mandatory}
            numeric={item.numeric ?? null}
            initialNumericValue={numericValues?.get(item.id) ?? null}
            initialResult={initialResponses.get(item.id)?.result ?? null}
            initialComment={initialResponses.get(item.id)?.comment ?? ""}
            initialCalibrationAssetId={initialResponses.get(item.id)?.calibrationAssetId ?? null}
            readOnly={readOnly}
            registerVerification={registerVerification}
            personnelCertVerification={personnelCertVerification}
            calibrationOptions={calibrationOptions}
            initialMaterialId={initialResponses.get(item.id)?.materialId ?? null}
            initialWelderId={initialResponses.get(item.id)?.welderId ?? null}
            initialUpdatedAt={initialResponses.get(item.id)?.updatedAt ?? null}
            fixAssigneeId={fixAssignments?.get(item.id)?.id ?? null}
            fixAssigneeName={fixAssignments?.get(item.id)?.name ?? null}
            fixOptions={fixOptions}
            initialNoNcrReason={initialResponses.get(item.id)?.noNcrReason ?? null}
            hasNcr={hasNcr}
            materialOptions={materialOptions}
            welderOptions={welderOptions}
            onResultChange={(result) =>
              setAnsweredIds((prev) => {
                const next = new Set(prev);
                if (result) next.add(item.id);
                else next.delete(item.id);
                return next;
              })
            }
            onSavingChange={(saving) => setSavingCount((prev) => Math.max(0, prev + (saving ? 1 : -1)))}
            projectId={projectId}
            itpItemId={itpItemId}
            photos={itemPhotos.get(item.id) ?? []}
            itemDocuments={itemDocuments.get(item.id) ?? []}
            vaultOptions={vaultOptions}
            vaultFolders={vaultFolders}
          />
        ))}
        {items.length === 0 && <p className="p-4 text-sm text-muted"><Tx>This checklist has no items yet.</Tx></p>}
      </div>
      {photoSlot}
      {canExecute && (
        <div id="complete-section" className="scroll-mt-16">
          {allAnswered ? (hasEvidencePhoto ? completeSlot : missingPhotoSlot) : incompleteSlot}
        </div>
      )}
      {canExecute && totalCount > 0 && (
        <>
          {/* Spacer so the fixed bar never covers the last content on mobile. */}
          <div className="h-24 md:hidden" aria-hidden="true" />
          <div
            className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-2 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] backdrop-blur md:hidden"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 text-sm" aria-live="polite">
                <p className="font-medium text-ink">
                  {answeredCount} <Tx>of</Tx> {totalCount} <Tx>answered</Tx>
                </p>
                <p className={mandatoryRemaining > 0 ? "truncate text-xs text-danger" : "truncate text-xs " + syncStatus.className}>
                  {mandatoryRemaining > 0 ? `${mandatoryRemaining} mandatory left` : syncStatus.label}
                </p>
              </div>
              <button
                type="button"
                disabled={!allAnswered}
                onClick={() => document.getElementById("complete-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="min-h-12 shrink-0 rounded-lg bg-burgundy px-5 text-base font-bold text-white disabled:bg-muted disabled:opacity-60"
              >
                {allAnswered ? (hasEvidencePhoto ? "Complete" : "Add evidence") : "Complete"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
