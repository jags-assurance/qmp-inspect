import Link from "next/link";
import { CONNECTOR_REGISTRY } from "@/lib/connectors/registry";

/**
 * R21 — makes the connector stubs (Aconex/Procore/ProjectWise) visible and discoverable on the
 * Document Vault itself, not just dead code sitting in lib/connectors/. Every status shown here is
 * a real isConfigured() check (an env var either being set or not), never a hardcoded label — see
 * each connector's own file for exactly what it checks and why none of them are configured in this
 * environment.
 */
export function ConnectorsPanel() {
  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">External document platforms</h2>
      <p className="mt-1 text-xs text-muted">
        Import documents directly from a project&rsquo;s Aconex, Procore or ProjectWise instance.
        Not yet functional here — see{" "}
        <Link href="/inspect/organisation/cloud-sync" className="text-burgundy hover:underline">
          Cloud folder sync
        </Link>{" "}
        for the SharePoint/OneDrive equivalent.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {CONNECTOR_REGISTRY.map((connector) => (
          <li key={connector.platformName} className="flex items-center justify-between py-2 text-sm">
            <span className="text-ink">{connector.platformName}</span>
            <span
              className={
                connector.isConfigured()
                  ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                  : "rounded-full bg-off-white px-2 py-0.5 text-xs font-medium text-muted"
              }
            >
              {connector.isConfigured() ? "Connected" : "Not connected"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
