"use client";

import { useActionState, useState } from "react";
import { addMaterialEntryAction, type AddMaterialEntryState } from "@/lib/registers/actions";
import {
  MATERIAL_APPROVAL_STATUSES,
  MATERIAL_APPROVAL_STATUS_LABELS,
  MATERIAL_RECEIPT_STATUSES,
  MATERIAL_RECEIPT_STATUS_LABELS,
  type MaterialReceiptStatus,
} from "@/lib/registers/types";
import { Button } from "@/components/ui/button";

const initialState: AddMaterialEntryState = { error: null };

export function AddMaterialForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(addMaterialEntryAction, initialState);
  const [receiptStatus, setReceiptStatus] = useState<MaterialReceiptStatus>("released");
  const needsDisposition = receiptStatus !== "released";

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="min-w-56 flex-1">
        <label htmlFor="material_description" className="block text-xs font-medium text-ink">
          Material
        </label>
        <input
          id="material_description"
          name="material_description"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-40">
        <label htmlFor="submittal_reference" className="block text-xs font-medium text-ink">
          Submittal ref.
        </label>
        <input
          id="submittal_reference"
          name="submittal_reference"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-48">
        <label htmlFor="approval_status" className="block text-xs font-medium text-ink">
          Approval status
        </label>
        <select
          id="approval_status"
          name="approval_status"
          defaultValue="A"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          {MATERIAL_APPROVAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status} — {MATERIAL_APPROVAL_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div className="w-36">
        <label htmlFor="approved_date" className="block text-xs font-medium text-ink">
          Approved date
        </label>
        <input
          id="approved_date"
          name="approved_date"
          type="date"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-36">
        <label htmlFor="heat_number" className="block text-xs font-medium text-ink">
          Heat no.
        </label>
        <input
          id="heat_number"
          name="heat_number"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-36">
        <label htmlFor="batch_number" className="block text-xs font-medium text-ink">
          Batch no.
        </label>
        <input
          id="batch_number"
          name="batch_number"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-36">
        <label htmlFor="po_reference" className="block text-xs font-medium text-ink">
          PO ref.
        </label>
        <input
          id="po_reference"
          name="po_reference"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-44">
        <label htmlFor="certificate_reference" className="block text-xs font-medium text-ink">
          CoC / MTC ref.
        </label>
        <input
          id="certificate_reference"
          name="certificate_reference"
          placeholder="Certificate of conformance / material test cert"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-56">
        <label htmlFor="receipt_status" className="block text-xs font-medium text-ink">
          Receiving inspection
        </label>
        <select
          id="receipt_status"
          name="receipt_status"
          value={receiptStatus}
          onChange={(e) => setReceiptStatus(e.target.value as MaterialReceiptStatus)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          {MATERIAL_RECEIPT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {MATERIAL_RECEIPT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      {needsDisposition && (
        <div className="min-w-56 flex-1">
          <label htmlFor="disposition_notes" className="block text-xs font-medium text-ink">
            Disposition notes <span className="text-danger">*</span>
          </label>
          <input
            id="disposition_notes"
            name="disposition_notes"
            required
            placeholder="Why quarantined/on hold, and what's needed to release it"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
      )}

      <div className="min-w-40 flex-1">
        <label htmlFor="material_notes" className="block text-xs font-medium text-ink">
          Notes
        </label>
        <input
          id="material_notes"
          name="notes"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add material"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
