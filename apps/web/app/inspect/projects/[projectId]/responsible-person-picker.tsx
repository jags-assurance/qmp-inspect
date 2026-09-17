"use client";

import { useActionState } from "react";
import { setResponsiblePersonAction, type SetResponsiblePersonState } from "@/lib/projects/actions";

const initialState: SetResponsiblePersonState = { error: null };

/**
 * Admin-only picker for projects.responsible_person_id, drawn from the same "eligible users" set
 * reassign-party-form.tsx uses — anyone whose access_grants already reach this project's organisation
 * or the project itself.
 */
export function ResponsiblePersonPicker({
  projectId,
  currentResponsiblePersonId,
  eligibleUsers,
}: {
  projectId: string;
  currentResponsiblePersonId: string | null;
  eligibleUsers: { id: string; full_name: string; email: string }[];
}) {
  const [state, formAction, pending] = useActionState(setResponsiblePersonAction, initialState);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <select
        name="responsible_person_id"
        defaultValue={currentResponsiblePersonId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-burgundy"
      >
        <option value="">— none set —</option>
        {eligibleUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name} ({u.email})
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-muted">Saving…</span>}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
