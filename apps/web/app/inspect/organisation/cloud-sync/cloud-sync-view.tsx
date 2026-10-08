import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CLOUD_FOLDER_SYNC_CONFIGS_TABLE, type CloudFolderSyncConfigRow } from "@/lib/cloud-sync/types";
import { isCloudSyncConfigured } from "@/lib/cloud-sync/gate";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { CloudFolderSyncForm } from "./cloud-folder-sync-form";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

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
export async function CloudFolderSyncView({ searchParams, embedded }: {
  searchParams: { org?: string };
  embedded?: boolean;
}) {
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("organizations").select("id, name").order("name").returns<OrganizationOption[]>();
  const organizations = data ?? [];

  const { org: orgIdParam } = searchParams;
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
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink"><T>Cloud folder sync</T></Heading>
        <PageGuide
          title={tl("Cloud folder sync — how this works")}
          points={[
            "Admin-only — this is an external-integration configuration act, same boundary as Plans & Seats and Reporting, not a self-managed client's own org setting like branding/numbering.",
            "You can save which SharePoint/OneDrive folder to sync against an organisation even before live syncing is possible — the configuration is stored now and syncing begins automatically once a JAGS admin registers an Azure app and sets the Microsoft Graph OAuth env vars (MICROSOFT_GRAPH_CLIENT_ID/SECRET/TENANT_ID).",
            "Without those credentials configured for this deployment, nothing actually syncs yet — the banner at the top says so.",
            "This is separate from Aconex/Procore/ProjectWise connectors, which live on the Document Vault page instead.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        <T>Point a SharePoint or OneDrive folder at an organisation so its documents can flow into the Document Vault automatically.</T>
      </p>

      {!syncConfigured && (
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <p className="font-semibold"><T>Not yet connected — requires Microsoft OAuth app credentials.</T></p>
          <p className="mt-1">
            <T>Live syncing isn&rsquo;t possible in this environment yet: no</T>{" "}
            <code className="doc-id"><T>MICROSOFT_GRAPH_CLIENT_ID</T></code> /{" "}
            <code className="doc-id"><T>MICROSOFT_GRAPH_CLIENT_SECRET</T></code> /{" "}
            <code className="doc-id"><T>MICROSOFT_GRAPH_TENANT_ID</T></code> <T>are configured for this deployment. You can still save which folder should be synced below — that configuration is stored now, and syncing will begin automatically once a JAGS admin registers an Azure app and sets those variables (see the code comment in</T>{" "}
            <code className="doc-id"><T>lib/cloud-sync/gate.ts</T></code> <T>for the exact steps).</T>
          </p>
        </div>
      )}

      <OrgPickerForm organizations={organizations} selectedOrgId={selectedOrg?.id ?? null} />

      {selectedOrg && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">{selectedOrg.name}</h2>

          {config && (
            <p className="mt-1 text-xs text-muted">
              <T>Currently pointed at a</T> {config.provider === "sharepoint" ? "SharePoint" : "OneDrive"}{" "}
              <T>folder, saved</T> {new Date(config.connected_at).toLocaleString("en-GB")}.
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
        <T>Looking for Aconex, Procore or ProjectWise instead? See the connector list on the</T>{" "}
        <Link href="/inspect/vault" className="text-burgundy hover:underline">
          <T>Document Vault</T>
        </Link>{" "}
        (R21).
      </p>
    </div>
  );
}
