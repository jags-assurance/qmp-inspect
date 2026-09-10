"use client";

export interface OrgOption {
  id: string;
  name: string;
}

// See apps/web/app/inspect/vault/project-picker-form.tsx for why this tiny wrapper exists: an
// inline event handler is still a function, so it can't be defined directly in a Server Component
// even on a plain HTML element.
export function OrgPickerForm({ organizations, selectedOrgId }: { organizations: OrgOption[]; selectedOrgId: string | null }) {
  return (
    <form className="mt-6 max-w-xs">
      <label htmlFor="org" className="block text-sm font-medium text-ink">
        Organisation
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
