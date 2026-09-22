import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CLOUD_FOLDER_SYNC_CONFIGS_TABLE, type CloudFolderSyncConfigRow } from "@/lib/cloud-sync/types";
import { isCloudSyncConfigured } from "@/lib/cloud-sync/gate";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { CloudFolderSyncForm } from "./cloud-folder-sync-form";

interface OrganizationOption {
  id: string;
  name: string;
}

/**
 * R20c — cloud folder sync settings. Admin-only (this is an external-integration configuration
 * act, same boundary as Plans & Seats/Reporting, not a self-managed client's own org settings like
 * branding/numbering are). See lib/cloud-sync/gate.ts for exactly what "not yet connected" means
 * and what real Graph API sync would need.
 */
export default async function CloudFolderSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("organizations").select("id, name").order("name").returns<OrganizationOption[]>();
  const organizations = data ?? [];

  const { org: orgIdParam } = await searchParams;
  const selectedOrg = organizations.find((o) => o.id === orgIdParam) ?? organizations[0] ?? null;

  let config: CloudFolderSyncConfigRow | null = null;
  if (selectedOrg) {
    const { data: configRow } = await supabase
      .from(CLOUD_FOLDER_SYNC_CONFIGS_TABLE)
      .select("*")
      .eq("organization_id", selectedOrg.id)
      .maybeSingle<CloudFolderSyncConfigRow>();
    config = configRow ?? null;
  }

  const syncConfigured = isCloudSyncConfigured();

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">Cloud folder sync</h1>
      <p className="mt-1 text-sm text-muted">
        Point a SharePoint or OneDrive folder at an organisation so its documents can flow into the
        Document Vault automatically.
      </p>

      {!syncConfigured && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Not yet connected — requires Microsoft OAuth app credentials.</p>
          <p className="mt-1">
            Live syncing isn&rsquo;t possible in this environment yet: no{" "}
            <code className="doc-id">MICROSOFT_GRAPH_CLIENT_ID</code> /{" "}
            <code className="doc-id">MICROSOFT_GRAPH_CLIENT_SECRET</code> /{" "}
            <code className="doc-id">MICROSOFT_GRAPH_TENANT_ID</code> are configured for this
            deployment. You can still save which folder should be synced below — that configuration
            is stored now, and syncing will begin automatically once a JAGS admin registers an Azure
            app and sets those variables (see the code comment in{" "}
            <code className="doc-id">lib/cloud-sync/gate.ts</code> for the exact steps).
          </p>
        </div>
      )}

      <OrgPickerForm organizations={organizations} selectedOrgId={selectedOrg?.id ?? null} />

      {selectedOrg && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">{selectedOrg.name}</h2>

          {config && (
            <p className="mt-1 text-xs text-muted">
              Currently pointed at a {config.provider === "sharepoint" ? "SharePoint" : "OneDrive"}{" "}
              folder, saved {new Date(config.connected_at).toLocaleString()}.
            </p>
          )}

          <div className="mt-3">
            <CloudFolderSyncForm
              organizationId={selectedOrg.id}
              provider={config?.provider ?? null}
              folderReference={config?.folder_reference ?? null}
            />
          </div>
        </div>
      )}

      <p className="mt-8 text-sm text-muted">
        Looking for Aconex, Procore or ProjectWise instead? See the connector list on the{" "}
        <Link href="/inspect/vault" className="text-burgundy hover:underline">
          Document Vault
        </Link>{" "}
        (R21).
      </p>
    </div>
  );
}
