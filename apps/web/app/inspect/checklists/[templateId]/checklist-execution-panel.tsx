"use client";

import { useState, type ReactNode } from "react";
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
  canExecute,
  photoSlot,
  completeSlot,
  incompleteSlot,
}: {
  templateId: string;
  inspectionRecordId: string;
  items: ChecklistItem[];
  initialResponses: Map<string, { result: ChecklistResponseResult; comment: string | null }>;
  readOnly: boolean;
  registerVerification: RegisterVerificationResult | null;
  canExecute: boolean;
  /** Rendered between the response rows and the complete/incomplete slot below. */
  photoSlot: ReactNode;
  /** Rendered once every item has a response (Complete-inspection form + consistency check). */
  completeSlot: ReactNode;
  /** Rendered while items remain unanswered. */
  incompleteSlot: ReactNode;
}) {
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set(initialResponses.keys()));

  const totalCount = items.length;
  const answeredCount = answeredIds.size;
  const answeredPct = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
  const allAnswered = answeredCount === totalCount;

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
            readOnly={readOnly}
            registerVerification={registerVerification}
            onResultChange={(result) =>
              setAnsweredIds((prev) => {
                const next = new Set(prev);
                if (result) next.add(item.id);
                else next.delete(item.id);
                return next;
              })
            }
          />
        ))}
        {items.length === 0 && <p className="p-4 text-sm text-muted">This checklist has no items yet.</p>}
      </div>
      {photoSlot}
      {canExecute && (allAnswered ? completeSlot : incompleteSlot)}
    </>
  );
}
