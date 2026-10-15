"use client";

import { useActionState } from "react";
import { renameOrganizationAction, setOrganizationActiveAction, type OrganizationLifecycleState } from "@/lib/organizations/actions";
import { FormMessage } from "@/components/ui/form-message";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";

const initialState: OrganizationLifecycleState = { error: null, message: null };

/** Admin controls: rename (name only, slug unchanged) and deactivate / reactivate (reason required, data kept). */
export function OrganizationLifecycleControl({ organizationId, name, isActive }: { organizationId: string; name: string; isActive: boolean }) {
  const [renameState, renameAction, renaming] = useActionState(renameOrganizationAction, initialState);
  const [activeState, activeAction, toggling] = useActionState(setOrganizationActiveAction, initialState);
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <form action={renameAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="organization_id" value={organizationId} />
        <label className="text-xs font-medium text-ink">
          <Tx>Organisation name</Tx>
          <input name="name" defaultValue={name} maxLength={120} className="mt-1 block min-h-9 w-64 rounded-md border border-border bg-surface px-2 py-1 text-sm" />
        </label>
        <Button type="submit" disabled={renaming} variant="outline" size="sm">
          {renaming ? "Saving…" : "Rename"}
        </Button>
        <FormMessage error={renameState.error} success={renameState.message} className="basis-full" />
      </form>
      <form action={activeAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="activate" value={isActive ? "false" : "true"} />
        {isActive && (
          <label className="text-xs font-medium text-ink">
            <Tx>Reason for deactivating</Tx>
            <input name="reason" required maxLength={500} autoComplete="off" className="mt-1 block min-h-9 w-64 rounded-md border border-border bg-surface px-2 py-1 text-sm" />
          </label>
        )}
        <Button type="submit" disabled={toggling} variant="outline" size="sm">
          {toggling ? "Saving…" : isActive ? "Deactivate" : "Reactivate"}
        </Button>
        <p className="basis-full text-xs text-muted">
          {isActive ? (
            <Tx>Deactivating hides the organisation from pickers and makes its projects read-only. Nothing is deleted; reactivate any time.</Tx>
          ) : (
            <Tx>Reactivating restores the organisation and makes its projects editable again.</Tx>
          )}
        </p>
        <FormMessage error={activeState.error} success={activeState.message} className="basis-full" />
      </form>
    </div>
  );
}
