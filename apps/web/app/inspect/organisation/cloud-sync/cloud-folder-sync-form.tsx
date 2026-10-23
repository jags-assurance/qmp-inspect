"use client";

import { useActionState } from "react";
import {
  saveCloudFolderSyncConfigAction,
  clearCloudFolderSyncConfigAction,
  type CloudFolderSyncConfigState,
} from "@/lib/cloud-sync/actions";
import type { CloudSyncProvider } from "@/lib/cloud-sync/types";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
  const tl = useTranslate();
  const [saveState, saveAction, savePending] = useActionState(saveCloudFolderSyncConfigAction, initialState);
  const keepValuesSubmit1 = useKeepFormValues(saveState, saveAction);
  const [clearState, clearAction, clearPending] = useActionState(clearCloudFolderSyncConfigAction, initialState);
  const keepValuesSubmit_clearAction = useKeepFormValues(clearState, clearAction);

  return (
    <div className="space-y-4">
      <form onSubmit={keepValuesSubmit1} className="space-y-3">
        <input type="hidden" name="organization_id" value={organizationId} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <FormField label="Provider">
              <select
              name="provider"
              defaultValue={provider ?? "sharepoint"}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            >
              <option value="sharepoint"><Tx>SharePoint</Tx></option>
              <option value="onedrive"><Tx>OneDrive</Tx></option>
            </select>
            </FormField>
          </div>

          <div className="sm:col-span-2">
            <FormField label="Folder URL or ID">
              <input aria-label={tl("https://yourtenant.sharepoint.com/sites/.../Shared Documents/Project Files")}
              name="folder_reference"
              defaultValue={folderReference ?? ""}
              placeholder={tl("https://yourtenant.sharepoint.com/sites/.../Shared Documents/Project Files")}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
            </FormField>
          </div>
        </div>

        {saveState.error && <p role="alert" className="text-sm text-danger">{saveState.error}</p>}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={savePending}>
            {savePending ? "Saving…" : folderReference ? "Update saved folder" : "Save folder"}
          </Button>

          {folderReference && (
            <form onSubmit={keepValuesSubmit_clearAction}>
              <input type="hidden" name="organization_id" value={organizationId} />
              <Button type="submit" variant="outline" disabled={clearPending}>
                {clearPending ? "Clearing…" : "Clear"}
              </Button>
            </form>
          )}
        </div>

        {clearState.error && <p role="alert" className="text-sm text-danger">{clearState.error}</p>}
      </form>
    </div>
  );
}
