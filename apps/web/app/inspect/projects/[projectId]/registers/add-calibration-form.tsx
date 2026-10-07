"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addCalibrationEntryAction, type AddCalibrationEntryState } from "@/lib/registers/actions";
import { Button } from "@/components/ui/button";
import { CertificateUpload } from "./certificate-upload";

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
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="min-w-48 flex-1">
        <label htmlFor="instrument_name" className="block text-xs font-medium text-ink">
          Instrument
        </label>
        <input id="instrument_name" name="instrument_name" required className={inputClass} />
      </div>

      <div className="w-36">
        <label htmlFor="instrument_tag" className="block text-xs font-medium text-ink">
          Instrument ID / tag
        </label>
        <input id="instrument_tag" name="instrument_tag" className={inputClass} />
      </div>

      <div className="w-40">
        <label htmlFor="cert_number" className="block text-xs font-medium text-ink">
          Cert number
        </label>
        <input id="cert_number" name="cert_number" required className={inputClass} />
      </div>

      <div className="min-w-36 flex-1">
        <label htmlFor="calibration_lab" className="block text-xs font-medium text-ink">
          Calibration lab
        </label>
        <input id="calibration_lab" name="calibration_lab" className={inputClass} />
      </div>

      <div className="w-36">
        <label htmlFor="cal_date" className="block text-xs font-medium text-ink">
          Cal. date
        </label>
        <input
          id="cal_date"
          name="cal_date"
          type="date"
          value={calDate}
          onChange={(e) => setCalDate(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="w-36">
        <label htmlFor="due_date" className="block text-xs font-medium text-ink">
          Due date
        </label>
        <input id="due_date" name="due_date" type="date" required min={calDate || undefined} className={inputClass} />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="cal_notes" className="block text-xs font-medium text-ink">
          Notes
        </label>
        <input id="cal_notes" name="notes" className={inputClass} />
      </div>

      <CertificateUpload key={formKey} projectId={projectId} kind="calibration" />

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add instrument"}
      </Button>

      {added && <p className="text-sm text-green-700">Added</p>}
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
