"use client";

import { useActionState } from "react";
import {
  addPersonnelCertificationEntryAction,
  type AddPersonnelCertificationEntryState,
} from "@/lib/registers/actions";
import { Button } from "@/components/ui/button";

const initialState: AddPersonnelCertificationEntryState = { error: null };

export function AddPersonnelCertificationForm({
  projectId,
  projectParties,
}: {
  projectId: string;
  projectParties: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(addPersonnelCertificationEntryAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="min-w-40 flex-1">
        <label htmlFor="project_party_id" className="block text-xs font-medium text-ink">
          Person
        </label>
        <select
          id="project_party_id"
          name="project_party_id"
          required
          defaultValue=""
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value="" disabled>
            Select…
          </option>
          {projectParties.map((party) => (
            <option key={party.id} value={party.id}>
              {party.name}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="certification_type" className="block text-xs font-medium text-ink">
          Certification
        </label>
        <input
          id="certification_type"
          name="certification_type"
          required
          placeholder="e.g. AWS CWI, ASNT NDT Level II"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-32">
        <label htmlFor="cert_number" className="block text-xs font-medium text-ink">
          Cert No.
        </label>
        <input
          id="cert_number"
          name="cert_number"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-36">
        <label htmlFor="issued_date" className="block text-xs font-medium text-ink">
          Issued date
        </label>
        <input
          id="issued_date"
          name="issued_date"
          type="date"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-36">
        <label htmlFor="expiry_date" className="block text-xs font-medium text-ink">
          Expiry date
        </label>
        <input
          id="expiry_date"
          name="expiry_date"
          type="date"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="cert_notes" className="block text-xs font-medium text-ink">
          Notes
        </label>
        <input
          id="cert_notes"
          name="notes"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add certification"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
