"use client";

import { TodayButton } from "@/components/ui/today-button";
import { useActionState, useState } from "react";
import { updateProjectDetailsAction, type UpdateProjectDetailsState } from "@/lib/projects/actions";
import { Button } from "@/components/ui/button";
import { TimeZonePicker } from "@/components/domain/timezone-picker";
import { Tx } from "@/components/domain/tx";
import { FieldError } from "@/components/ui/field-error";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: UpdateProjectDetailsState = { error: null };

export interface EditableProject {
  id: string;
  project_number: string;
  name: string;
  site_location: string | null;
  country: string | null;
  contract_number: string | null;
  start_date: string | null;
  end_date: string | null;
  /** IANA zone (projects.timezone); null when not yet known. */
  timezone?: string | null;
}

const inputClass = "mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink";

/** Collapsible "Edit details" form for the project's descriptive fields (admin / self-managed only). */
export function EditProjectDetailsForm({ project }: { project: EditableProject }) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateProjectDetailsAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex min-h-11 items-center text-sm text-burgundy hover:underline"
      >
        {open ? "Close editor" : "Edit project details"}
      </button>
      {open && (
        <form onSubmit={keepValuesSubmit} className="mt-2 grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-2">
          <input type="hidden" name="project_id" value={project.id} />
          <label className="text-sm text-ink">
            <Tx>Project number *</Tx>
            <input name="project_number" required maxLength={60} defaultValue={project.project_number} aria-invalid={state.fieldErrors?.project_number ? true : undefined} className={inputClass} />
            <FieldError message={state.fieldErrors?.project_number} />
          </label>
          <label className="text-sm text-ink">
            <Tx>Project name *</Tx>
            <input name="name" required maxLength={200} defaultValue={project.name} aria-invalid={state.fieldErrors?.name ? true : undefined} className={inputClass} />
            <FieldError message={state.fieldErrors?.name} />
          </label>
          <label className="text-sm text-ink">
            <Tx>Site location</Tx>
            <input name="site_location" defaultValue={project.site_location ?? ""} className={inputClass} />
          </label>
          <label className="text-sm text-ink">
            <Tx>Country</Tx>
            <input name="country" defaultValue={project.country ?? ""} className={inputClass} />
          </label>
          <label className="text-sm text-ink">
            <Tx>Contract number</Tx>
            <input name="contract_number" defaultValue={project.contract_number ?? ""} className={inputClass} />
          </label>
          <label className="text-sm text-ink">
            <Tx>Site time zone</Tx>
            <TimeZonePicker blankLabel={tl("Keep current")} defaultValue={project.timezone ?? ""} className={inputClass} />
            <FieldError message={state.fieldErrors?.timezone} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-ink">
              <Tx>Start date</Tx>
              <input type="date" max="9999-12-31" name="start_date" defaultValue={project.start_date ?? ""} className={inputClass} />
              <TodayButton name="start_date" />
            </label>
            <label className="text-sm text-ink">
              <Tx>End date</Tx>
              <input type="date" max="9999-12-31" name="end_date" defaultValue={project.end_date ?? ""} aria-invalid={state.fieldErrors?.end_date ? true : undefined} className={inputClass} />
              <FieldError message={state.fieldErrors?.end_date} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save details"}
            </Button>
            {state.saved && !state.error && <span className="text-sm text-success"><Tx>Saved.</Tx></span>}
            {state.error && !state.fieldErrors && <span role="alert" className="text-sm text-danger">{state.error}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
