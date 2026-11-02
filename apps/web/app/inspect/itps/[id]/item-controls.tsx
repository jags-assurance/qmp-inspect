"use client";

import { useRestoreOnError } from "@/lib/hooks/use-keep-form-values";
import { ActivityDetails } from "./activity-details";
import { REGISTER_KINDS, REGISTER_KIND_LABEL } from "@/lib/itps/required-registers";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
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
  const formId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [state, formAction, pending] = useActionState(editItpItemAction, initialState);
  const captureForm = useRestoreOnError(state);
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

  const fld = "min-h-11 w-full min-w-0 rounded-md border border-control-border bg-surface px-3 py-2 text-sm";
  const editSheet = (
    <Sheet
      open={isEditing}
      onClose={() => setIsEditing(false)}
      title={<Tx>Edit activity</Tx>}
      description={itemNumber}
      className="sm:max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>
            <Tx>Cancel</Tx>
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {/* The ref is only written inside the submit handler, never read during render. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      <form id={formId} action={formAction} onSubmit={(e) => {
          captureForm(e.currentTarget);
          gateSubmit(revisionOpts, "revision_reason", () => { hasSubmittedRef.current = true; })(e);
        }} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input type="hidden" name="itp_id" value={itpId} />
        <input type="hidden" name="item_id" value={itemId} />
        <input type="hidden" name="revision_reason" />
        <label className="block text-sm font-medium text-ink">
          <Tx>Item number</Tx>
          <input name="item_number" defaultValue={itemNumber} required className={fld + " mt-1 font-normal"} />
        </label>
        <label className="block text-sm font-medium text-ink">
          <Tx>Activity</Tx>
          <input name="activity" defaultValue={activity} required className={fld + " mt-1 font-normal"} />
        </label>
        <label className="block text-sm font-medium text-ink sm:col-span-2">
          <Tx>Acceptance criteria</Tx>
          <input name="acceptance_criteria" defaultValue={acceptanceCriteria ?? ""} placeholder={tl("Acceptance criteria")} className={fld + " mt-1 font-normal"} />
        </label>
        <label className="block text-sm font-medium text-ink sm:col-span-2">
          <Tx>Reference spec / clause</Tx>
          <input aria-label={tl("Reference spec / clause")} name="reference_spec" defaultValue={referenceSpec ?? ""} placeholder={tl("Reference spec / clause")} className={fld + " mt-1 font-normal"} />
        </label>
        <label className="block text-sm font-medium text-ink">
          <Tx>Method</Tx>
          <input aria-label={tl("Method")} name="method" defaultValue={method ?? ""} placeholder={tl("Method")} className={fld + " mt-1 font-normal"} />
        </label>
        <label className="block text-sm font-medium text-ink">
          <Tx>Frequency / sample</Tx>
          <input aria-label={tl("Frequency / sample")} name="frequency" defaultValue={frequency ?? ""} placeholder={tl("Frequency / sample")} className={fld + " mt-1 font-normal"} />
        </label>
        <label className="block text-sm font-medium text-ink">
          <Tx>Evidence</Tx>
          <select name="evidence_type" defaultValue={String(evidenceType)} className={fld + " mt-1 font-normal"}>
            <option value="1"><Tx>Checklist</Tx></option>
            <option value="2"><Tx>Document upload (certificate, test report, readings)</Tx></option>
            {evidenceType === 3 && <option value="3"><Tx>Measurement (older ITP)</Tx></option>}
          </select>
        </label>
        <label className="block text-sm font-medium text-ink">
          <Tx>Discipline</Tx>
          <select name="discipline_id" defaultValue={disciplineId ?? ""} className={fld + " mt-1 font-normal"}>
            <option value=""><Tx>— Discipline —</Tx></option>
            {disciplines.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-ink">
          <Tx>Notice hrs</Tx>
          <input aria-label={tl("Notice hrs")} name="notice_hours_override" type="number" min={0} defaultValue={noticeHoursOverride ?? ""} placeholder={tl("Notice hrs")} className={fld + " mt-1 font-normal"} />
        </label>
        <label className="block text-sm font-medium text-ink">
          <Tx>Planned date</Tx>
          <input name="planned_date" type="date" max="9999-12-31" defaultValue={plannedDate ?? ""} className={fld + " mt-1 font-normal"} />
        </label>
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:col-span-2">
          <legend className="mb-1 text-sm text-muted"><Tx>Registers this activity needs (leave all unticked to let the system infer it)</Tx></legend>
          <input type="hidden" name="registers_sent" value="1" />
          {REGISTER_KINDS.map((kind) => (
            <label key={kind} className="flex min-h-8 items-center gap-1.5 text-sm text-ink [@media(pointer:coarse)]:min-h-11">
              <input type="checkbox" name="required_registers" value={kind} defaultChecked={requiredRegisters.includes(kind)} className="h-4 w-4" />
              {REGISTER_KIND_LABEL[kind]}
            </label>
          ))}
        </fieldset>
        {state.error && <p role="alert" className="text-sm text-danger sm:col-span-2">{state.error}</p>}
      </form>
    </Sheet>
  );

  return (
      <div>
        {dialog}
        {editSheet}
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
                className="hidden"
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
              className="hidden"
            >
              {deletePending ? "Deleting…" : "Delete"}
            </Button>
          </form>
          <div>
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
