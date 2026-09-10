"use client";

import { useActionState } from "react";
import { createDataBookAction, type CreateDataBookState } from "@/lib/databook/actions";
import { Button } from "@/components/ui/button";

const initialState: CreateDataBookState = { error: null };

export function CreateDataBookForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(createDataBookAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="w-48">
        <label htmlFor="book_number" className="block text-xs font-medium text-ink">
          Book number
        </label>
        <input
          id="book_number"
          name="book_number"
          required
          placeholder="e.g. DB-001"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="min-w-56 flex-1">
        <label htmlFor="title" className="block text-xs font-medium text-ink">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="e.g. Final Quality Data Book"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creating…" : "+ New Data Book"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
