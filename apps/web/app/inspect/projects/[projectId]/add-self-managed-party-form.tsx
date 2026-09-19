"use client";

import { useActionState } from "react";
import { addSelfManagedPartyAction, type AddSelfManagedPartyState } from "@/lib/projects/actions";
import { Button } from "@/components/ui/button";

const initialState: AddSelfManagedPartyState = { error: null };

const PARTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "client", label: "Client" },
  { value: "main_contractor", label: "Main Contractor" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "tpi_lab", label: "TPI / Lab" },
  { value: "vendor", label: "Vendor" },
];

/**
 * The self-managed-client counterpart to AddProjectPartyForm — styled the same way, shown instead
 * of (never alongside) that form, to an eligible self-managed-org user rather than a JAGS Admin.
 * See addSelfManagedPartyAction (lib/projects/actions.ts) for why this only takes an email rather
 * than the full contact-detail fields: it's onboarding an EXISTING platform account, not recording
 * a new contact, so email is the only thing needed to find that account.
 */
export function AddSelfManagedPartyForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(addSelfManagedPartyAction, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-md border border-dashed border-border bg-off-white p-3">
      <input type="hidden" name="project_id" value={projectId} />
      <p className="text-xs text-muted">
        Add someone who already has a JAGS Assurance account — including a contractor, subcontractor
        or vendor from outside your own organisation — to this project.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sm_party_type" className="block text-xs font-medium text-ink">
            Party type
          </label>
          <select
            id="sm_party_type"
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
        </div>
        <div>
          <label htmlFor="sm_party_name" className="block text-xs font-medium text-ink">
            Organisation / company name
          </label>
          <input
            id="sm_party_name"
            name="name"
            required
            placeholder="e.g. Voltway Electrical Ltd"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="sm_party_email" className="block text-xs font-medium text-ink">
            Their JAGS Assurance account email
          </label>
          <input
            id="sm_party_email"
            name="email"
            type="email"
            required
            placeholder="name@company.com"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "+ Add party"}
      </Button>
    </form>
  );
}
