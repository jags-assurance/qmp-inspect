"use client";

import { useActionState } from "react";
import {
  saveCloudFolderSyncConfigAction,
  clearCloudFolderSyncConfigAction,
  type CloudFolderSyncConfigState,
} from "@/lib/cloud-sync/actions";
import type { CloudSyncProvider } from "@/lib/cloud-sync/types";
import { Button } from "@/components/ui/button";

const initialState: CloudFolderSyncConfigState = { error: null };

export function CloudFolderSyncForm({
  organizationId,
  provider,
  folderReference,
}: {
  organizationId: string;
  provider: CloudSyncProvider | null;
  folderReference: string | null;
}) {
  const [saveState, saveAction, savePending] = useActionState(saveCloudFolderSyncConfigAction, initialState);
  const [clearState, clearAction, clearPending] = useActionState(clearCloudFolderSyncConfigAction, initialState);

  return (
    <div className="space-y-4">
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="organization_id" value={organizationId} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="provider" className="block text-xs text-muted">
              Provider
            </label>
            <select
              id="provider"
              name="provider"
              defaultValue={provider ?? "sharepoint"}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            >
              <option value="sharepoint">SharePoint</option>
              <option value="onedrive">OneDrive</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="folder_reference" className="block text-xs text-muted">
              Folder URL or ID
            </label>
            <input
              id="folder_reference"
              name="folder_reference"
              defaultValue={folderReference ?? ""}
              placeholder="https://yourtenant.sharepoint.com/sites/.../Shared Documents/Project Files"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>
        </div>

        {saveState.error && <p className="text-sm text-danger">{saveState.error}</p>}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={savePending}>
            {savePending ? "Saving…" : folderReference ? "Update saved folder" : "Save folder"}
          </Button>

          {folderReference && (
            <form action={clearAction}>
              <input type="hidden" name="organization_id" value={organizationId} />
              <Button type="submit" variant="outline" disabled={clearPending}>
                {clearPending ? "Clearing…" : "Clear"}
              </Button>
            </form>
          )}
        </div>

        {clearState.error && <p className="text-sm text-danger">{clearState.error}</p>}
      </form>
    </div>
  );
}
