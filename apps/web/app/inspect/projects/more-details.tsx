import type { ReactNode } from "react";
import { Tx } from "@/components/domain/tx";
import { Disclosure } from "@/components/ui/disclosure";

/** One-line native toggle for secondary content (closed by default). Thin wrapper over <Disclosure variant="pill">. */
export function MoreDetails({ label = "Details", children }: { label?: string; children: ReactNode }) {
  return (
    <Disclosure variant="pill" summary={<Tx>{label}</Tx>} className="mt-2" bodyClassName="text-sm text-muted">
      {children}
    </Disclosure>
  );
}
