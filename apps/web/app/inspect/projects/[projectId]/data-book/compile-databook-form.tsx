"use client";

import { useActionState, useState } from "react";
import { compileDataBookAction, type CompileDataBookState } from "@/lib/databook/actions";
import { Button } from "@/components/ui/button";

const initialState: CompileDataBookState = { error: null };

export interface OpenPunchItemPreview {
  id: string;
  description: string;
  location: string | null;
  due_date: string | null;
  project_parties: { name: string } | null;
}

/**
 * Compile action for one draft Data Book row. The override checkbox + reason are only shown once
 * the user opts into them — compiling with open items outstanding is a deliberate, visible choice,
 * not a default the button quietly falls back to. Checking it also shows exactly which punch items
 * are still open and their due dates: a Conditional Handover is only meaningful if the person
 * approving it can see what they're actually agreeing to carry forward (see
 * 20260920050000_conditional_handover.sql — this same list is what compileDataBookAction snapshots
 * onto the Data Book, and later onto the handover certificate).
 */
export function CompileDataBookForm({
  projectId,
  dataBookId,
  isReady,
  openPunchItems,
}: {
  projectId: string;
  dataBookId: string;
  isReady: boolean;
  openPunchItems: OpenPunchItemPreview[];
}) {
  const [state, formAction, pending] = useActionState(compileDataBookAction, initialState);
  const [useOverride, setUseOverride] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="data_book_id" value={dataBookId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="override" value={useOverride ? "true" : "false"} />

      {!isReady && (
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={useOverride}
            onChange={(e) => setUseOverride(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Compile anyway (override — outstanding items remain)
        </label>
      )}

      {useOverride && (
        <>
          {openPunchItems.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2">
              <p className="text-xs font-medium text-ink">
                This Conditional Handover will list {openPunchItems.length} open item{openPunchItems.length === 1 ? "" : "s"}:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink">
                {openPunchItems.map((item) => (
                  <li key={item.id}>
                    • {item.description}
                    {item.location ? ` (${item.location})` : ""} — {item.project_parties?.name ?? "unassigned"}, due{" "}
                    {item.due_date ? new Date(item.due_date).toLocaleDateString() : "no date set"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <textarea
            name="override_reason"
            required
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for compiling with open items outstanding…"
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-burgundy"
          />
        </>
      )}

      {state.error && <p className="text-xs text-danger">{state.error}</p>}

      <Button
        type="submit"
        size="sm"
        variant={isReady ? "primary" : "outline"}
        disabled={pending || (!isReady && (!useOverride || !reason.trim()))}
      >
        {pending ? "Compiling…" : "Compile Data Book"}
      </Button>
    </form>
  );
}
