"use client";

import { useSearchParams } from "next/navigation";
import { Tx } from "@/components/domain/tx";

export interface OrgOption {
  id: string;
  name: string;
}

// See apps/web/app/inspect/vault/project-picker-form.tsx for why this tiny wrapper exists: an
// inline event handler is still a function, so it can't be defined directly in a Server Component
// even on a plain HTML element.
export function OrgPickerForm({ organizations, selectedOrgId }: { organizations: OrgOption[]; selectedOrgId: string | null }) {
  // Inside the Settings workspace the active tab lives in ?section=; a GET form replaces the whole
  // query string, so carry it through or the picker would bounce back to the first section.
  const section = useSearchParams().get("section");
  return (
    <form className="mt-6 max-w-xs">
      {section && <input type="hidden" name="section" value={section} />}
      <label htmlFor="org" className="block text-sm font-medium text-ink">
        <Tx>Organisation</Tx>
      </label>
      <select
        id="org"
        name="org"
        defaultValue={selectedOrgId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </form>
  );
}
