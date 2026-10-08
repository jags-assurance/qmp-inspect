"use client";

import { useActionState } from "react";
import { createDataBookAction, type CreateDataBookState } from "@/lib/databook/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

const initialState: CreateDataBookState = { error: null };

/** `revisionOf`: the issued book this one revises - a reason is then required and recorded (S7-19). */
export function CreateDataBookForm({ projectId, revisionOf = null }: { projectId: string; revisionOf?: string | null }) {
  const [state, formAction, pending] = useActionState(createDataBookAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="w-48">
        <FormField label="Book number">
          <input
          name="book_number"
          required
          placeholder="e.g. DB-001"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="w-full sm:min-w-56 flex-1">
        <FormField label="Title">
          <input
          name="title"
          required
          placeholder="e.g. Final Quality Data Book"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      {revisionOf && (
        <div className="w-full">
          <FormField label={<>Why is this a revision of {revisionOf}?</>}>
            <textarea
            name="revision_reason"
            required
            minLength={10}
            maxLength={1000}
            rows={2}
            placeholder="What changed since the issued book (it will be recorded and the earlier certificate superseded when this is issued)"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
      )}

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creating…" : "+ New Data Book"}
      </Button>

      {state.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
