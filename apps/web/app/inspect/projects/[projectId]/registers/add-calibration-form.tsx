"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addCalibrationEntryAction, type AddCalibrationEntryState } from "@/lib/registers/actions";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { FormMessage } from "@/components/ui/form-message";
import { CertificateUpload } from "./certificate-upload";
import { FormField } from "@/components/ui/form-field";

const initialState: AddCalibrationEntryState = { error: null };
const inputClass = "mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy";

export function AddCalibrationForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(addCalibrationEntryAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const [calDate, setCalDate] = useState("");
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
        setCalDate("");
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

      <div className="min-w-0">
        <FormField label="Instrument">
          <input name="instrument_name" required className={inputClass} />
        </FormField>
      </div>

      <div className="w-36">
        <FormField label="Instrument ID / tag">
          <input name="instrument_tag" className={inputClass} />
        </FormField>
      </div>

      <div className="w-40">
        <FormField label="Cert number">
          <input name="cert_number" required className={inputClass} />
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Calibration lab">
          <input name="calibration_lab" className={inputClass} />
        </FormField>
      </div>

      <div className="w-36">
        <FormField label="Cal. date">
          <input
          name="cal_date"
          type="date"
          value={calDate}
          onChange={(e) => setCalDate(e.target.value)}
          className={inputClass}
        />
        </FormField>
      </div>

      <div className="w-36">
        <FormField label="Due date">
          <input name="due_date" type="date" required min={calDate || undefined} className={inputClass} />
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Notes">
          <input name="notes" className={inputClass} />
        </FormField>
      </div>

      <CertificateUpload key={formKey} projectId={projectId} kind="calibration" />

      <StickyActionBar className="md:col-span-2">
        <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "+ Add instrument"}
      </Button>
      </StickyActionBar>

      {/* Live regions stay mounted so the result is announced; the leading ✓ means it is not colour-only. */}
      <FormMessage error={state.error} success={added ? "✓ Added" : null} className="w-full" />
    </form>
  );
}
