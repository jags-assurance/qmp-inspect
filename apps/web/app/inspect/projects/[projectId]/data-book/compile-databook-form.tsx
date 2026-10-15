"use client";

import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { formatLocationForDisplay } from "@/lib/checklists/location";
import { useActionState, useRef, useState, type FormEvent } from "react";
import { compileDataBookAction, type CompileDataBookState } from "@/lib/databook/actions";
import { Button } from "@/components/ui/button";
import { ConfirmTypeDialog } from "@/components/domain/confirm-type-dialog";
import { formatUtcDate } from "@/lib/databook/db-errors";
import { MoreDetails } from "@/components/domain/more-details";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  bookNumber,
  isReady,
  isAdmin = true,
  outstanding = [],
  openPunchItems,
}: {
  projectId: string;
  dataBookId: string;
  bookNumber: string;
  isReady: boolean;
  /** Overriding creates a Conditional Handover, which only a JAGS Admin may do. */
  isAdmin?: boolean;
  /** Short labels of every gate that is not met, shown in the confirmation. */
  outstanding?: string[];
  openPunchItems: OpenPunchItemPreview[];
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(compileDataBookAction, initialState);
  const [useOverride, setUseOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  // Compiling locks the book for review and issue and cannot be undone by the staff user, so confirm first.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (confirmed.current) {
      confirmed.current = false;
      return;
    }
    e.preventDefault();
    setConfirming(true);
  }

  const renderItem = (item: OpenPunchItemPreview) => (
    <li key={item.id}>
      • {item.description}
      {item.location ? ` (${formatLocationForDisplay(item.location)})` : ""} — {item.project_parties?.name ?? "unassigned"}<Tx>, due</Tx>{" "}
      {item.due_date ? formatUtcDate(item.due_date) : "no date set"}
    </li>
  );

  return (
    <>
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="data_book_id" value={dataBookId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="override" value={useOverride ? "true" : "false"} />

      {!isReady && !isAdmin && (
        <p className="text-xs text-muted"><Tx>Not all gates are met. Only a JAGS Admin can compile with an override (Conditional Handover).</Tx></p>
      )}
      {!isReady && isAdmin && (
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={useOverride}
            onChange={(e) => setUseOverride(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <Tx>Compile anyway (override — outstanding items remain)</Tx>
        </label>
      )}

      {useOverride && (
        <>
          {openPunchItems.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-2">
              <p className="text-xs font-medium text-ink">
                <Tx>This Conditional Handover will list</Tx> {openPunchItems.length} <Tx>open item</Tx>{openPunchItems.length === 1 ? "" : "s"}:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink">
                {openPunchItems.slice(0, 3).map(renderItem)}
              </ul>
              {openPunchItems.length > 3 && (
                <MoreDetails label={`Show all (${openPunchItems.length})`} className="mt-1">
                  <ul className="space-y-0.5 text-ink">{openPunchItems.slice(3).map(renderItem)}</ul>
                </MoreDetails>
              )}
            </div>
          )}
          <textarea
            name="override_reason"
            required
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tl("Reason for compiling with open items outstanding…")}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none sm:text-sm [@media(pointer:coarse)]:min-h-11 focus:border-burgundy"
          />
        </>
      )}

      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}

      <StickyActionBar className="w-full">
      <Button
        type="submit"
        size="lg" className="w-full sm:w-auto"
        variant={isReady ? "primary" : "outline"}
        disabled={pending || (!isReady && (!isAdmin || !useOverride || !reason.trim()))}
      >
        {pending ? "Compiling…" : "Compile Data Book"}
      </Button>
      </StickyActionBar>
    </form>
    {confirming && (
      <ConfirmTypeDialog
        title={useOverride ? "Compile with an override?" : "Compile this Data Book?"}
        phrase={bookNumber}
        confirmLabel="Compile"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          confirmed.current = true;
          setConfirming(false);
          formRef.current?.requestSubmit();
        }}
      >
        <p>
          <Tx>Compiling locks Data Book</Tx> <strong>{bookNumber}</strong> <Tx>for review and issue. Only a JAGS Admin can take it back to draft.</Tx>
        </p>
        {useOverride && outstanding.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-2">
            <p className="text-xs font-medium"><Tx>This Conditional Handover carries these outstanding items:</Tx></p>
            <ul className="mt-1 list-disc ps-4 text-xs">
              {outstanding.slice(0, 12).map((o) => (
                <li key={o}>{o}</li>
              ))}
              {outstanding.length > 12 && <li><Tx>… and</Tx> {outstanding.length - 12} <Tx>more</Tx></li>}
            </ul>
            {reason.trim() && <p className="mt-1 text-xs"><Tx>Reason:</Tx> {reason.trim()}</p>}
          </div>
        )}
      </ConfirmTypeDialog>
    )}
    </>
  );
}
