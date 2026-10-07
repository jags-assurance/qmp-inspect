"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  addPersonnelCertificationEntryAction,
  type AddPersonnelCertificationEntryState,
} from "@/lib/registers/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { CertificateUpload } from "./certificate-upload";

const initialState: AddPersonnelCertificationEntryState = { error: null };
const inputClass = "mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy";

export function AddPersonnelCertificationForm({
  projectId,
  projectParties,
  partyMembers = [],
}: {
  projectId: string;
  projectParties: { id: string; name: string }[];
  /** Named people in each party; a certificate can be assigned to one so the check follows the person. */
  partyMembers?: { user_id: string; party_id: string; party_name: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(addPersonnelCertificationEntryAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);
  const [issuedDate, setIssuedDate] = useState("");
  const [added, setAdded] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setAdded(false);
      return;
    }
    if (wasPending.current) {
      wasPending.current = false;
      if (!state.error) {
        formRef.current?.reset();
        setIssuedDate("");
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

      <div className="min-w-40 flex-1">
        <label htmlFor="project_party_id" className="block text-xs font-medium text-ink">
          Person
        </label>
        <select id="project_party_id" name="project_party_id" required defaultValue="" className={inputClass}>
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

      {partyMembers.length > 0 && (
        <div className="min-w-40 flex-1">
          <label htmlFor="holder_user_id" className="block text-xs font-medium text-ink">
            Named holder (optional)
          </label>
          <select id="holder_user_id" name="holder_user_id" defaultValue="" className={inputClass}>
            <option value="">Whole party</option>
            {partyMembers.map((m) => (
              <option key={`${m.party_id}-${m.user_id}`} value={m.user_id}>
                {m.name} ({m.party_name})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="min-w-40 flex-1">
        <label htmlFor="certification_type" className="block text-xs font-medium text-ink">
          Certification
        </label>
        <input
          id="certification_type"
          name="certification_type"
          required
          placeholder="e.g. AWS CWI, ASNT NDT Level II"
          className={inputClass}
        />
      </div>

      <div className="w-32">
        <label htmlFor="cert_number" className="block text-xs font-medium text-ink">
          Cert No.
        </label>
        <input id="cert_number" name="cert_number" className={inputClass} />
      </div>

      <div className="w-36">
        <label htmlFor="issued_date" className="block text-xs font-medium text-ink">
          Issued date
        </label>
        <input
          id="issued_date"
          name="issued_date"
          type="date"
          value={issuedDate}
          onChange={(e) => setIssuedDate(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="w-36">
        <label htmlFor="expiry_date" className="block text-xs font-medium text-ink">
          Expiry date
        </label>
        <input id="expiry_date" name="expiry_date" type="date" required min={issuedDate || undefined} className={inputClass} />
      </div>

      <div className="min-w-40 flex-1">
        <label htmlFor="cert_notes" className="block text-xs font-medium text-ink">
          Notes
        </label>
        <input id="cert_notes" name="notes" className={inputClass} />
      </div>

      <CertificateUpload key={formKey} projectId={projectId} kind="personnel" />

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add certification"}
      </Button>

      {/* Live regions stay mounted so the result is announced; the leading ✓ means it is not colour-only. */}
      <FormMessage error={state.error} success={added ? "✓ Added" : null} className="w-full" />
    </form>
  );
}
