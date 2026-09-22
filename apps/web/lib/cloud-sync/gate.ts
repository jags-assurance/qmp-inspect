/**
 * R20c — "cloud folder sync features are hidden/gated cleanly if no Microsoft Graph OAuth app
 * credentials are configured." Mirrors lib/ai/gate.ts's isAiConfigured() exactly: a real check
 * (env vars either present or not), never a hardcoded true/false, used at render time to decide
 * whether to show a live-sync entry point at all versus an honest "not yet connected" message.
 *
 * ============================================================================================
 * WHAT REAL SYNC WOULD NEED, ONCE THESE ARE SET
 * ============================================================================================
 * This app has no Microsoft Entra ID (Azure AD) app registration and no Graph API credentials
 * anywhere in its env — none exist in this sandbox, and none can be created here (that's an
 * Azure-portal action a real deployer takes, not a code change). Once one exists:
 *   1. Set MICROSOFT_GRAPH_CLIENT_ID, MICROSOFT_GRAPH_CLIENT_SECRET and MICROSOFT_GRAPH_TENANT_ID
 *      from that app registration (Certificates & secrets -> a client secret; the app needs the
 *      Sites.Read.All / Files.Read.All Graph application permissions, admin-consented).
 *   2. Implement an OAuth client-credentials token exchange against
 *      https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token (app-only auth — this is a
 *      background sync job, not a per-user "sign in with Microsoft" flow, so client-credentials
 *      is the right grant type, not auth-code).
 *   3. Resolve each org's stored folder_reference (cloud_folder_sync_configs.folder_reference —
 *      a pasted SharePoint/OneDrive URL or a Graph drive-item ID) to a driveId/itemId pair via
 *      GET /v1.0/shares/{encoded-sharing-url}/driveItem (for a URL) or used directly (for an ID).
 *   4. Poll GET /v1.0/drives/{driveId}/items/{itemId}/delta on a schedule (a cron/worker job —
 *      this app's worker/ package already runs scheduled jobs, e.g. worker/src/jobs/, and would
 *      be the natural home for this) to enumerate new/changed files, and for each: download its
 *      bytes (GET .../content) and call lib/vault/actions.ts's uploadVaultDocumentCore with a
 *      service-role Supabase client — the exact same reusable core the email-inbound webhook
 *      (R20b, app/api/vault/email-inbound/route.ts) already uses, into whichever vault folder the
 *      org's config maps to.
 *   5. Persist the delta query's nextLink/deltaLink per org (a new column on
 *      cloud_folder_sync_configs, e.g. delta_cursor) so each poll only fetches what changed since
 *      the last one, not a full re-scan.
 *
 * None of that exists yet — this file's job is only the honest "is it even possible to try" gate.
 */
export function isCloudSyncConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_GRAPH_CLIENT_ID &&
      process.env.MICROSOFT_GRAPH_CLIENT_SECRET &&
      process.env.MICROSOFT_GRAPH_TENANT_ID
  );
}
