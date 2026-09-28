"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/**
 * A plain `<a href>` file-download/export link with real "Preparing…" feedback while the server
 * generates the file — a UX audit found several of these (ITP register Excel export, ITP detail's
 * offline-XLSX/Word export, checklist-library export) with zero visual feedback beyond the browser's
 * own easy-to-miss tab spinner. A direct download link never fires a JS completion event, so this
 * reverts on a short timer rather than a real "done" signal.
 */
export function ExportLink({
  href,
  children,
  className,
  pendingLabel = "Preparing…",
}: {
  href: string;
  /** Either a fixed node, or a render function receiving `pending` for callers that need to keep
   *  their own button styling while swapping just the label (e.g. `<Button>{pending ? "…" : "Excel"}</Button>`). */
  children: ReactNode | ((pending: boolean) => ReactNode);
  className?: string;
  pendingLabel?: string;
}) {
  const [pending, setPending] = useState(false);

  return (
    <a
      href={href}
      onClick={() => {
        setPending(true);
        setTimeout(() => setPending(false), 4000);
      }}
      aria-disabled={pending}
      className={`${className ?? ""} aria-disabled:pointer-events-none aria-disabled:opacity-50`}
    >
      {typeof children === "function" ? children(pending) : pending ? pendingLabel : children}
    </a>
  );
}
