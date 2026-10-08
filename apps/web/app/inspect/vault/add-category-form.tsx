"use client";

import { useActionState } from "react";
import { createCustomVaultFolderAction, type CreateCustomVaultFolderState } from "@/lib/vault/folder-actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

const initialState: CreateCustomVaultFolderState = { error: null };

export function AddCategoryForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(createCustomVaultFolderAction, initialState);

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <div>
        <FormField label="Add a custom category">
          <input
          name="name"
          placeholder="e.g. Site Photos"
          required
          maxLength={60}
          className="mt-1 w-56 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "+ Add category"}
      </Button>
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
