"use client";

import { useActionState } from "react";
import { setModuleLicenseAction, type ModuleLicenseState } from "@/lib/module-licensing/actions";
import type { ModuleKey } from "@/lib/module-licensing/types";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: ModuleLicenseState = { error: null };

// A single row's toggle. Auto-submits on change (same "checkbox as its own form" convention as
// level-row-form's checkboxes, minus a separate Save button — there's nothing else to edit per row
// here, so immediate-submit reads clearer than a pending "Save" click).
export function ModuleLicenseToggle({
  organizationId,
  moduleKey,
  label,
  isLicensed,
}: {
  organizationId: string;
  moduleKey: ModuleKey;
  label: string;
  isLicensed: boolean;
}) {
  const [state, formAction, pending] = useActionState(setModuleLicenseAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-ink">{label}</span>
      <form onSubmit={keepValuesSubmit} className="flex items-center gap-2">
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="module_key" value={moduleKey} />
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            name="is_licensed"
            defaultChecked={isLicensed}
            disabled={pending}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          />
          {pending ? "Saving…" : isLicensed ? "Licensed" : "Not licensed"}
        </label>
      </form>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </div>
  );
}
