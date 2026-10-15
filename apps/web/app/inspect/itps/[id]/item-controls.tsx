"use client";

import { ActivityDetails } from "./activity-details";
import { REGISTER_KINDS, REGISTER_KIND_LABEL } from "@/lib/itps/required-registers";
import { useActionState, useEffect, useRef, useState } from "react";
import { useConfirm, type ConfirmOptions } from "@/components/ui/confirm-dialog";
import {
  deleteItpItemAction,
  editItpItemAction,
  moveItemDownAction,
  moveItemUpAction,
  type DeleteItemState,
  type EditItemState,
} from "@/lib/itps/actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { CellMenu } from "@/components/domain/cell-menu";

const initialState: EditItemState = { error: null };
const initialDeleteState: DeleteItemState = { error: null };

/**
 * Edit + Delete for a single ITP item row in the sign-off grid — previously the grid only supported
 * Add (see AddItemForm), with no way to fix or remove an activity short of the staff-only offline
 * .xlsx re-upload. Shown in place of the plain item-number/activity text once canEditContent is
 * true, mirroring SectionControls' inline-toggle + revision-reason dialog pattern.
 */
export function ItemControls({
  itpId,
  itemId,
  itemNumber,
  activity,
  acceptanceCriteria,
  referenceSpec,
  method,
  frequency,
  evidenceType,
  disciplineId,
  noticeHoursOverride,
  plannedDate = null,
  requiredRegisters = [],
  disciplines,
  isIssued,
}: {
  itpId: string;
  itemId: string;
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  referenceSpec: string | null;
  method: string | null;
  frequency: string | null;
  evidenceType: number;
  disciplineId: string | null;
  noticeHoursOverride: number | null;
  plannedDate?: string | null;
  /** S3-06: registers this activity explicitly requires (empty = none set; the keyword heuristic still applies). */
  requiredRegisters?: string[];
  disciplines: { id: string; code: string; name: string }[];
  isIssued: boolean;
}) {
  const tl = useTranslate();
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(editItpItemAction, initialState);
  const [deleteState, deleteFormAction, deletePending] = useActionState(deleteItpItemAction, initialDeleteState);
  const { gateSubmit, dialog } = useConfirm();
  const hasSubmittedRef = useRef(false);
  const upRef = useRef<HTMLFormElement>(null);
  const downRef = useRef<HTMLFormElement>(null);
  const deleteRef = useRef<HTMLFormElement>(null);

  // Close the edit form once a save actually succeeds (state flips to no-error after a real
  // submission) — a plain `state.error === null` check alone would also fire on first mount, since
  // that's initialState's own shape.
  useEffect(() => {
    if (hasSubmittedRef.current && !pending && state.error === null) {
      hasSubmittedRef.current = false;
      setIsEditing(false);
    }
  }, [state, pending]);

  const revisionReason = {
    label: "Reason for this change",
    required: true,
  } as const;
  const revisionOpts: ConfirmOptions | null = isIssued
    ? {
        title: "Change an issued ITP",
        message: "This ITP has already been issued. The change will start a new revision.",
        confirmLabel: "Apply change",
        reason: revisionReason,
      }
    : null;
  const deleteOpts: ConfirmOptions = {
    title: "Delete activity?",
    message: `Delete activity "${itemNumber}: ${activity}"? This also deletes its sign-off levels. An activity with inspection, sign-off or evidence history cannot be deleted. This cannot be undone.${
      isIssued ? " This ITP has already been issued, so the deletion will start a new revision." : ""
    }`,
    confirmLabel: "Delete",
    destructive: true,
    reason: isIssued ? revisionReason : undefined,
  };

  if (!isEditing) {
    return (
      <div>
        {dialog}
        <p className="text-sm text-ink">
          <span className="doc-id me-1.5 text-muted">{itemNumber}</span>
          {activity}
        </p>
        <ActivityDetails acceptanceCriteria={acceptanceCriteria} referenceSpec={referenceSpec} method={method} frequency={frequency} />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            onClick={() => setIsEditing(true)}
            variant="outline" size="sm"
          >
            <Tx>Edit</Tx>
          </Button>
          {(["up", "down"] as const).map((direction) => (
            <form key={direction} ref={direction === "up" ? upRef : downRef} action={direction === "up" ? moveItemUpAction : moveItemDownAction} onSubmit={gateSubmit(revisionOpts, "revision_reason")}>
              <input type="hidden" name="item_id" value={itemId} />
              <input type="hidden" name="revision_reason" />
              <Button
                type="submit"
                aria-label={direction === "up" ? "Move activity up" : "Move activity down"}
                variant="outline" size="sm"
                className="max-sm:hidden"
              >
                {direction === "up" ? "↑" : "↓"}
              </Button>
            </form>
          ))}
          <form ref={deleteRef} action={deleteFormAction} onSubmit={gateSubmit(deleteOpts, "revision_reason")}>
            <input type="hidden" name="itp_id" value={itpId} />
            <input type="hidden" name="item_id" value={itemId} />
            <input type="hidden" name="revision_reason" />
            <Button
              type="submit"
              disabled={deletePending}
              variant="danger-outline" size="sm"
              className="max-sm:hidden"
            >
              {deletePending ? "Deleting…" : "Delete"}
            </Button>
          </form>
          <div className="sm:hidden">
            <CellMenu
              ariaLabel={tl("More activity actions")}
              items={[
                { key: "up", label: <Tx>Move activity up</Tx>, onSelect: () => upRef.current?.requestSubmit() },
                { key: "down", label: <Tx>Move activity down</Tx>, onSelect: () => downRef.current?.requestSubmit() },
                { key: "delete", label: <span className="text-danger"><Tx>Delete</Tx></span>, disabled: deletePending, onSelect: () => deleteRef.current?.requestSubmit() },
              ]}
            />
          </div>
        </div>
        {deleteState.error && <p role="alert" className="mt-1 text-xs text-danger">{deleteState.error}</p>}
      </div>
    );
  }

  return (
    // The ref is only written inside the submit handler, never read during render.
    // eslint-disable-next-line react-hooks/refs
    <form action={formAction} onSubmit={gateSubmit(revisionOpts, "revision_reason", () => { hasSubmittedRef.current = true; })} className="flex flex-col gap-1.5">
      {dialog}
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="revision_reason" />
      <div className="flex gap-1.5">
        <input
          name="item_number"
          defaultValue={itemNumber}
          required
          className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
        <input
          name="activity"
          defaultValue={activity}
          required
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
      </div>
      <input
        name="acceptance_criteria"
        defaultValue={acceptanceCriteria ?? ""}
        placeholder={tl("Acceptance criteria")}
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
      />
      <div className="flex flex-wrap gap-1.5">
        <input
          name="reference_spec"
          defaultValue={referenceSpec ?? ""}
          placeholder={tl("Reference spec / clause")}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
        <input
          name="method"
          defaultValue={method ?? ""}
          placeholder={tl("Method")}
          className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
        <input
          name="frequency"
          defaultValue={frequency ?? ""}
          placeholder={tl("Frequency / sample")}
          className="w-32 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <select
          name="evidence_type"
          defaultValue={String(evidenceType)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        >
          <option value="1"><Tx>Checklist</Tx></option>
          <option value="2"><Tx>Document upload (certificate, test report, readings)</Tx></option>
          {evidenceType === 3 && <option value="3"><Tx>Measurement (older ITP)</Tx></option>}
        </select>
        <select
          name="discipline_id"
          defaultValue={disciplineId ?? ""}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        >
          <option value=""><Tx>— Discipline —</Tx></option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </select>
        <input
          name="notice_hours_override"
          type="number"
          min={0}
          defaultValue={noticeHoursOverride ?? ""}
          placeholder={tl("Notice hrs")}
          className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
        <input
          name="planned_date"
          type="date"
          defaultValue={plannedDate ?? ""}
          aria-label={tl("Planned date")}
          title={tl("Planned date")}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
        />
      </div>
      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <legend className="mb-0.5 text-xs text-muted"><Tx>Registers this activity needs (leave all unticked to let the system infer it)</Tx></legend>
        <input type="hidden" name="registers_sent" value="1" />
        {REGISTER_KINDS.map((kind) => (
          <label key={kind} className="flex items-center gap-1 text-xs text-ink">
            <input type="checkbox" name="required_registers" value={kind} defaultChecked={requiredRegisters.includes(kind)} />
            {REGISTER_KIND_LABEL[kind]}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-1.5">
        <Button
          type="submit"
          disabled={pending}
          variant="outline" size="sm"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          onClick={() => setIsEditing(false)}
          variant="outline" size="sm"
        >
          <Tx>Cancel</Tx>
        </Button>
      </div>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
