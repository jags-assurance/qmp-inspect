"use client";

import { useActionState } from "react";
import { createCustomVaultFolderAction, type CreateCustomVaultFolderState } from "@/lib/vault/folder-actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: CreateCustomVaultFolderState = { error: null };

export function AddCategoryForm({ projectId }: { projectId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(createCustomVaultFolderAction, initialState);

  return (
    <details className="group mt-4">
    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
      <Tx>Add a custom category</Tx>
    </summary>
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <div>
        <FormField label="Category name">
          <input
          name="name"
          placeholder={tl("e.g. Site Photos")}
          required
          maxLength={60}
          className="mt-1 w-56 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "+ Add category"}
      </Button>
      {state.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
    </details>
  );
}
