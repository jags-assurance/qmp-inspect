import { T } from "@/components/domain/t";

/**
 * The Aconex, Procore and ProjectWise connectors (lib/connectors/*) and Cloud folder sync are not built
 * yet (they only check env vars or store a folder reference), so they are no longer listed here. The code
 * is kept; add a connector back to this panel once it actually imports documents.
 */
export function ConnectorsPanel() {
  return (
    <p className="mt-6 text-xs text-muted">
      <T>More connectors coming soon.</T>
    </p>
  );
}
