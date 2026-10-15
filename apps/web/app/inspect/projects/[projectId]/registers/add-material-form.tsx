"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CertificateUpload } from "./certificate-upload";
import { addMaterialEntryAction, type AddMaterialEntryState } from "@/lib/registers/actions";
import {
  MATERIAL_APPROVAL_STATUSES,
  MATERIAL_APPROVAL_STATUS_LABELS,
  MATERIAL_RECEIPT_STATUSES,
  MATERIAL_RECEIPT_STATUS_LABELS,
  type MaterialReceiptStatus,
} from "@/lib/registers/types";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { FormMessage } from "@/components/ui/form-message";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: AddMaterialEntryState = { error: null };

export function AddMaterialForm({ projectId, isStaff }: { projectId: string; isStaff: boolean }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addMaterialEntryAction, initialState);
  const [receiptStatus, setReceiptStatus] = useState<MaterialReceiptStatus>("released");
  const needsDisposition = isStaff && receiptStatus !== "released" && receiptStatus !== "received_pending_inspection";
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const [added, setAdded] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
      setAdded(false);
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      if (!state.error) {
        formRef.current?.reset();
        setReceiptStatus("released");
        setFormKey((k) => k + 1);
        setAdded(true);
        const t = setTimeout(() => setAdded(false), 3000);
        return () => clearTimeout(t);
      }
    }
  }, [pending, state]);

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-1 items-end gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5 md:grid-cols-2">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="min-w-0 md:col-span-2">
        <FormField label="Material">
          <input
          name="material_description"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-40">
        <FormField label="Submittal ref.">
          <input
          name="submittal_reference"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-48">
        <FormField label="Approval status">
          <select
          name="approval_status"
          defaultValue={isStaff ? "A" : "C"}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          {MATERIAL_APPROVAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status} — {MATERIAL_APPROVAL_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        </FormField>
      </div>

      <div className="w-36">
        <FormField label="Approved date">
          <input
          name="approved_date"
          type="date"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-36">
        <FormField label="Heat no.">
          <input
          name="heat_number"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-36">
        <FormField label="Batch no.">
          <input
          name="batch_number"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-36">
        <FormField label="PO ref.">
          <input
          name="po_reference"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-44">
        <FormField label="CoC / MTC ref.">
          <input
          name="certificate_reference"
          placeholder={tl("Certificate of conformance / material test cert")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-44">
        <FormField label="Supplier">
          <input
          name="supplier"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-32">
        <FormField label="Quantity">
          <input
          name="quantity"
          placeholder="e.g. 40 m"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      {isStaff ? (
        <div className="w-56">
          <FormField label="Receiving inspection">
            <select
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
          </FormField>
        </div>
      ) : (
        <p className="w-full text-xs text-muted-foreground">
          <Tx>New deliveries are recorded as &lsquo;received — pending inspection&rsquo;; JAGS staff release them after the receiving inspection.</Tx>
        </p>
      )}

      {needsDisposition && (
        <div className="min-w-0 md:col-span-2">
          <label htmlFor="disposition_notes" className="block text-xs font-medium text-ink">
            <Tx>Disposition notes</Tx> <span className="text-danger">*</span>
          </label>
          <input
            id="disposition_notes"
            name="disposition_notes"
            required
            placeholder={tl("Why quarantined/on hold, and what's needed to release it")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
      )}

      <div className="min-w-0">
        <FormField label="Notes">
          <input
          name="notes"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <CertificateUpload key={formKey} projectId={projectId} kind="material" />

      <StickyActionBar inCard className="md:col-span-2">
        <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "+ Add material"}
      </Button>
      </StickyActionBar>

      {/* Live regions stay mounted so the result is announced; the leading ✓ means it is not colour-only. */}
      <FormMessage error={state.error} success={added ? "✓ Added" : null} className="w-full" />
    </form>
  );
}
