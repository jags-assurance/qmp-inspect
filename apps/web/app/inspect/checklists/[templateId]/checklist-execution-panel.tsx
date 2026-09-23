"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ResponseRow } from "./response-row";
import type { ChecklistResponseResult } from "@/lib/checklists/db-types";
import type { RegisterVerificationResult } from "@/lib/registers/verify";

interface ChecklistItem {
  id: string;
  item_number: string;
  description: string;
  is_mandatory: boolean;
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
  readOnly,
  registerVerification,
  personnelCertVerification,
  calibrationOptions,
  canExecute,
  photoSlot,
  completeSlot,
  incompleteSlot,
  projectId,
  itpItemId,
  itemPhotos,
}: {
  templateId: string;
  inspectionRecordId: string;
  items: ChecklistItem[];
  initialResponses: Map<string, { result: ChecklistResponseResult; comment: string | null; calibrationAssetId: string | null }>;
  readOnly: boolean;
  registerVerification: RegisterVerificationResult | null;
  /** R92-R100 personnel-cert soft-stop for the executing party — independent of registerVerification
   *  above, see registers/verify.ts. */
  personnelCertVerification: RegisterVerificationResult | null;
  /** Every calibration_register row for this project, offered as a "which instrument did you use"
   *  picker on each row when registerVerification.kind === "calibration". Empty otherwise. */
  calibrationOptions: { id: string; instrument_name: string; cert_number: string; status: string }[];
  canExecute: boolean;
  /** Rendered between the response rows and the complete/incomplete slot below. */
  photoSlot: ReactNode;
  /** Rendered once every item has a response (Complete-inspection form + consistency check). */
  completeSlot: ReactNode;
  /** Rendered while items remain unanswered. */
  incompleteSlot: ReactNode;
  /** Needed to build each item-linked photo's storage path. */
  projectId: string;
  /** The parent ITP activity — threaded down to ResponseRow's "Raise NCR" link (R45). */
  itpItemId: string;
  /** Each checklist item's own evidence photos (checklist_item_id === that item's id), keyed by
   *  checklist_item_id, for the compact per-row "+ photo" affordance. */
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
  const allAnswered = answeredCount === totalCount;

  const syncStatus = !isOnline
    ? { label: "Offline — will sync when reconnected", className: "text-warning" }
    : savingCount > 0
      ? { label: "Saving…", className: "text-muted" }
      : { label: "All changes saved", className: "text-success" };

  return (
    <>
      {totalCount > 0 && (
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">
              {answeredCount} of {totalCount} answered
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
            initialResult={initialResponses.get(item.id)?.result ?? null}
            initialComment={initialResponses.get(item.id)?.comment ?? ""}
            initialCalibrationAssetId={initialResponses.get(item.id)?.calibrationAssetId ?? null}
            readOnly={readOnly}
            registerVerification={registerVerification}
            personnelCertVerification={personnelCertVerification}
            calibrationOptions={calibrationOptions}
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
          />
        ))}
        {items.length === 0 && <p className="p-4 text-sm text-muted">This checklist has no items yet.</p>}
      </div>
      {photoSlot}
      {canExecute && (allAnswered ? completeSlot : incompleteSlot)}
    </>
  );
}
