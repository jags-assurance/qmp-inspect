"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addWelderQualificationEntryAction, type AddWelderQualificationEntryState } from "@/lib/registers/actions";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { FormMessage } from "@/components/ui/form-message";
import { CertificateUpload } from "./certificate-upload";
import { FormField } from "@/components/ui/form-field";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: AddWelderQualificationEntryState = { error: null };
const inputClass = "mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy";

export function AddWelderQualificationForm({ projectId }: { projectId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addWelderQualificationEntryAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
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
    <form ref={formRef} onSubmit={keepValuesSubmit} className="grid grid-cols-1 items-end gap-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5 md:grid-cols-2">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="w-40">
        <FormField label="Welder ID">
          <input name="welder_identifier" required className={inputClass} />
        </FormField>
      </div>

      <div className="w-40">
        <FormField label="WPQ record no.">
          <input name="wpq_number" className={inputClass} />
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Qualified WPS">
          <input name="qualified_wps" required className={inputClass} />
        </FormField>
      </div>

      <div className="w-32">
        <FormField label="Process">
          <input name="process" placeholder={tl("e.g. GTAW")} className={inputClass} />
        </FormField>
      </div>

      <div className="w-32">
        <FormField label="Position">
          <input name="position" placeholder="e.g. 6G" className={inputClass} />
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Ranges">
          <input name="qualified_ranges" className={inputClass} />
        </FormField>
      </div>

      <div className="w-36">
        <FormField label="Expiry date">
          <input name="expiry_date" type="date" required className={inputClass} />
        </FormField>
      </div>

      <div className="min-w-0">
        <FormField label="Notes">
          <input name="notes" className={inputClass} />
        </FormField>
      </div>

      <CertificateUpload key={formKey} projectId={projectId} kind="welder" />

      <StickyActionBar inCard className="md:col-span-2">
        <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "+ Add welder"}
      </Button>
      </StickyActionBar>

      {/* Live regions stay mounted so the result is announced; the leading ✓ means it is not colour-only. */}
      <FormMessage error={state.error} success={added ? "✓ Added" : null} className="w-full" />
    </form>
  );
}
