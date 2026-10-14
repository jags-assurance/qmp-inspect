import type { ReactNode } from "react";
import { Tx } from "@/components/domain/tx";

/**
 * Long explanations, rules text and rarely used panels behind one small native toggle, styled like
 * the ITP activity "Details" toggle. Collapsed by default; works in server and client components.
 */
export function MoreDetails({ label = "Details", children, className = "mt-2", bare = false }: {
  label?: string;
  /** Render children as-is (for large cards) instead of the small muted text wrapper. */
  bare?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`group ${className}`}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
        <Tx>{label}</Tx>
      </summary>
      <div className={bare ? "mt-3" : "mt-1.5 max-w-prose space-y-1 text-xs text-muted"}>{children}</div>
    </details>
  );
}
