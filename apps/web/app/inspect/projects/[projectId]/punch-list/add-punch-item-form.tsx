"use client";

import { useActionState } from "react";
import { addPunchItemAction, type AddPunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";

const initialState: AddPunchItemState = { error: null };

export function AddPunchItemForm({
  projectId,
  projectParties,
}: {
  projectId: string;
  projectParties: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(addPunchItemAction, initialState);

  return (
    <form action={formAction} encType="multipart/form-data" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="w-full min-w-56 flex-1">
        <label htmlFor="description" className="block text-xs font-medium text-ink">
          Description
        </label>
        <input
          id="description"
          name="description"
          required
          placeholder="What needs fixing before handover…"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-full sm:w-40">
        <label htmlFor="location" className="block text-xs font-medium text-ink">
          Location
        </label>
        <input
          id="location"
          name="location"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-full sm:w-48">
        <label htmlFor="responsible_party_id" className="block text-xs font-medium text-ink">
          Responsible party
        </label>
        <select
          id="responsible_party_id"
          name="responsible_party_id"
          defaultValue=""
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value="">Unassigned</option>
          {projectParties.map((party) => (
            <option key={party.id} value={party.id}>
              {party.name}
            </option>
          ))}
        </select>
      </div>

      <div className="w-full sm:w-36">
        <label htmlFor="due_date" className="block text-xs font-medium text-ink">
          Due date
        </label>
        <input
          id="due_date"
          name="due_date"
          type="date"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="w-full sm:w-32">
        <label htmlFor="priority" className="block text-xs font-medium text-ink">
          Priority
        </label>
        <select
          id="priority"
          name="priority"
          defaultValue="B"
          className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value="A">A - critical</option>
          <option value="B">B - major</option>
          <option value="C">C - minor</option>
        </select>
      </div>

      <div className="w-full sm:w-56">
        <label htmlFor="photos" className="block text-xs font-medium text-ink">
          Photo (optional)
        </label>
        <input
          id="photos"
          name="photos"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="mt-1 w-full text-xs"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "+ Add punch item"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
