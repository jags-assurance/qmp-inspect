"use client";

import { useActionState } from "react";
import { createCustomVaultFolderAction, type CreateCustomVaultFolderState } from "@/lib/vault/folder-actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { Disclosure } from "@/components/ui/disclosure";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: CreateCustomVaultFolderState = { error: null };

export function AddCategoryForm({ projectId }: { projectId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(createCustomVaultFolderAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <Disclosure variant="pill" summary={<Tx>Add a custom category</Tx>} className="mt-5" bodyClassName="mt-2">
    <form onSubmit={keepValuesSubmit} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <div>
        <FormField label="Category name">
          <input
          name="name"
          placeholder={tl("e.g. Site Photos")}
          required
          maxLength={60}
          className="mt-1 min-h-10 w-full max-w-56 rounded-md border border-border bg-surface px-3 py-2 text-base focus:border-burgundy sm:w-56 sm:text-sm [@media(pointer:coarse)]:min-h-11"
        />
        </FormField>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "+ Add category"}
      </Button>
      {state.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
    </Disclosure>
  );
}
