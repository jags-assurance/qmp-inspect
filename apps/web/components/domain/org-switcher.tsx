"use client";

import { useRef } from "react";

/** Header dropdown for users with grants in more than one organisation. Submits the server action on change. */
export function OrgSwitcher({
  options,
  activeId,
  action,
}: {
  options: { id: string; name: string }[];
  activeId: string | null;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} className="flex items-center">
      <label className="sr-only" htmlFor="org-switcher">Organisation</label>
      <select
        id="org-switcher"
        name="organization_id"
        defaultValue={activeId ?? undefined}
        onChange={() => formRef.current?.requestSubmit()}
        className="min-h-11 max-w-44 truncate rounded-md border border-border bg-surface px-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-burgundy"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </form>
  );
}
