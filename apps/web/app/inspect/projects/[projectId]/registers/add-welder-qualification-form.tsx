"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addWelderQualificationEntryAction, type AddWelderQualificationEntryState } from "@/lib/registers/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { CertificateUpload } from "./certificate-upload";

const initialState: AddWelderQualificationEntryState = { error: null };
const inputClass = "mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy";

export function AddWelderQualificationForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(addWelderQualificationEntryAction, initialState);
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

      <div className="w-40">
        <label htmlFor="welder_identifier" className="block text-xs font-medium text-ink">
          Welder ID
        </label>
        <input id="welder_identifier" name="welder_identifier" required className={inputClass} />
      </div>

      <div className="w-40">
        <label htmlFor="wpq_number" className="block text-xs font-medium text-ink">
          WPQ record no.
        </label>
        <input id="wpq_number" name="wpq_number" className={inputClass} />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="qualified_wps" className="block text-xs font-medium text-ink">
          Qualified WPS
        </label>
        <input id="qualified_wps" name="qualified_wps" required className={inputClass} />
      </div>

      <div className="w-32">
        <label htmlFor="welder_process" className="block text-xs font-medium text-ink">
          Process
        </label>
        <input id="welder_process" name="process" placeholder="e.g. GTAW" className={inputClass} />
      </div>

      <div className="w-32">
        <label htmlFor="welder_position" className="block text-xs font-medium text-ink">
          Position
        </label>
        <input id="welder_position" name="position" placeholder="e.g. 6G" className={inputClass} />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="qualified_ranges" className="block text-xs font-medium text-ink">
          Ranges
        </label>
        <input id="qualified_ranges" name="qualified_ranges" className={inputClass} />
      </div>

      <div className="w-36">
        <label htmlFor="expiry_date" className="block text-xs font-medium text-ink">
          Expiry date
        </label>
        <input id="expiry_date" name="expiry_date" type="date" required className={inputClass} />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="welder_notes" className="block text-xs font-medium text-ink">
          Notes
        </label>
        <input id="welder_notes" name="notes" className={inputClass} />
      </div>

      <CertificateUpload key={formKey} projectId={projectId} kind="welder" />

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add welder"}
      </Button>

      {/* Live regions stay mounted so the result is announced; the leading ✓ means it is not colour-only. */}
      <FormMessage error={state.error} success={added ? "✓ Added" : null} className="w-full" />
    </form>
  );
}
