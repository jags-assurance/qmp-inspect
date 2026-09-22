// Domain type + table-name handle for `cloud_folder_sync_configs`
// (supabase/migrations/20260922100000_cloud_folder_sync_config.sql) — R20c cloud folder sync.
//
// Not in the generated Database type yet — same documented cast pattern as
// apps/web/lib/vault/types.ts / apps/web/lib/itp-approval-workflow/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const CLOUD_FOLDER_SYNC_CONFIGS_TABLE = "cloud_folder_sync_configs" as any;

export const CLOUD_SYNC_PROVIDERS = ["sharepoint", "onedrive"] as const;
export type CloudSyncProvider = (typeof CLOUD_SYNC_PROVIDERS)[number];

export interface CloudFolderSyncConfigRow {
  id: string;
  organization_id: string;
  provider: CloudSyncProvider;
  folder_reference: string;
  connected_by: string | null;
  connected_at: string;
  created_at: string;
  updated_at: string;
}
