"use client";

import { useActionState } from "react";
import { addSelfManagedPartyAction, type AddSelfManagedPartyState } from "@/lib/projects/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addSelfManagedPartyAction, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-md border border-dashed border-border bg-off-white p-3">
      <input type="hidden" name="project_id" value={projectId} />
      <p className="text-xs text-muted">
        <Tx>Add someone who already has an account.</Tx>
      </p>
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
            placeholder={tl("e.g. Voltway Electrical Ltd")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <FormField label="Their JAGS Assurance account email">
            <input aria-label={tl("name@company.com")}
            name="email"
            type="email"
            required
            placeholder={tl("name@company.com")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
      </div>

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "+ Add party"}
      </Button>
    </form>
  );
}
