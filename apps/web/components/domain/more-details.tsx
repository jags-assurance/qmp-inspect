import type { ReactNode } from "react";
import { Tx } from "@/components/domain/tx";
import { Disclosure } from "@/components/ui/disclosure";

/**
 * Long explanations, rules text and rarely used panels behind one small toggle. Thin wrapper over the
 * shared <Disclosure variant="pill">. Collapsed by default; works in server and client components.
 */
export function MoreDetails({ label = "Details", children, className = "mt-2", bare = false }: {
  label?: string;
  /** Render children as-is (for large cards) instead of the small muted text wrapper. */
  bare?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Disclosure
      variant="pill"
      summary={<Tx>{label}</Tx>}
      className={className}
      bodyClassName={bare ? "mt-3" : "mt-1.5 max-w-prose space-y-1 text-xs text-muted"}
    >
      {children}
    </Disclosure>
  );
}
