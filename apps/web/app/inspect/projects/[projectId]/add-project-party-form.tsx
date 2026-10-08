"use client";

import { useActionState } from "react";
import { addProjectPartyAction, type AddProjectPartyState } from "@/lib/projects/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

const initialState: AddProjectPartyState = { error: null };

const PARTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "client", label: "Client" },
  { value: "main_contractor", label: "Main Contractor" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "tpi_lab", label: "TPI / Lab" },
  { value: "vendor", label: "Vendor" },
  { value: "jags", label: "JAGS Assurance" },
];

export function AddProjectPartyForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(addProjectPartyAction, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-md border border-dashed border-border bg-off-white p-3">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <FormField label="Party type">
            <select
            name="party_type"
            required
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          >
            {PARTY_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          </FormField>
        </div>
        <div>
          <FormField label="Organisation / company name">
            <input
            name="name"
            required
            placeholder="e.g. Voltway Electrical Ltd"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
        <div>
          <label htmlFor="contact_name" className="block text-xs font-medium text-ink">
            Contact name <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="contact_name"
            name="contact_name"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label htmlFor="contact_email" className="block text-xs font-medium text-ink">
            Contact email <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <span className="block text-xs font-medium text-ink">Onboarded by</span>
          <div className="mt-1 flex items-center gap-4 text-sm text-ink">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="onboarded_by" value="jags" defaultChecked /> JAGS
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="onboarded_by" value="client" /> Client
            </label>
          </div>
        </div>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "+ Add party"}
      </Button>
    </form>
  );
}
