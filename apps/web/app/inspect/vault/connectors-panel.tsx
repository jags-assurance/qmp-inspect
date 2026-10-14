import Link from "next/link";
import { CONNECTOR_REGISTRY } from "@/lib/connectors/registry";
import { T } from "@/components/domain/t";

/**
 * R21 — makes the connector stubs (Aconex/Procore/ProjectWise) visible and discoverable on the
 * Document Vault itself, not just dead code sitting in lib/connectors/. Every status shown here is
 * a real isConfigured() check (an env var either being set or not), never a hardcoded label — see
 * each connector's own file for exactly what it checks and why none of them are configured in this
 * environment.
 */
export function ConnectorsPanel() {
  return (
    <details className="group mt-6">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
        <T>External document platforms</T>
      </summary>
      <div className="mt-2 rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-muted">
        <T>Aconex, Procore and ProjectWise import is not available yet. For SharePoint/OneDrive see</T>{" "}
        <Link href="/inspect/organisation/cloud-sync" className="text-burgundy hover:underline">
          <T>Cloud folder sync</T>
        </Link>.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {CONNECTOR_REGISTRY.map((connector) => (
          <li key={connector.platformName} className="flex items-center justify-between py-2 text-sm">
            <span className="text-ink">{connector.platformName}</span>
            <span
              className={
                connector.isConfigured()
                  ? "rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
                  : "rounded-full bg-off-white px-2 py-0.5 text-xs font-medium text-muted"
              }
            >
              {connector.isConfigured() ? "Connected" : "Not connected"}
            </span>
          </li>
        ))}
      </ul>
      </div>
    </details>
  );
}
