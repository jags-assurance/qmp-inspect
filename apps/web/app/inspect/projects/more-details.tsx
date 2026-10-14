import type { ReactNode } from "react";
import { Tx } from "@/components/domain/tx";

/** One-line native toggle for secondary content (closed by default). Same look as ActivityDetails. */
export function MoreDetails({ label = "Details", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
        <Tx>{label}</Tx>
      </summary>
      <div className="mt-2 text-sm text-muted">{children}</div>
    </details>
  );
}
