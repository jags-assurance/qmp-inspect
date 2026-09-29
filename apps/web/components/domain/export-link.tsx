"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * A plain `<a href>` file-download/export link with real "Preparing…" feedback while the server
 * generates the file — a UX audit found several of these (ITP register Excel export, ITP detail's
 * offline-XLSX/Word export, checklist-library export) with zero visual feedback beyond the browser's
 * own easy-to-miss tab spinner. A direct download link never fires a JS completion event, so this
 * reverts on a short timer rather than a real "done" signal.
 *
 * `children` must be a plain node, never a function — a real crash found live: the ITP register
 * page (a Server Component) passed a render-prop function as this component's children so the
 * caller could swap a `<Button>`'s label while pending, but a plain JS function can never cross the
 * Server -> Client Component boundary (only Server Actions can) — Next.js throws "Functions are not
 * valid as a child of Client Components" the moment it tries to serialize that RSC payload. Use
 * `asButton` + `label`/`pendingLabel` instead, which keeps the whole pending/label swap inside this
 * already-client component.
 */
export function ExportLink({
  href,
  children,
  className,
  pendingLabel = "Preparing…",
  asButton = false,
  buttonVariant = "outline",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  pendingLabel?: string;
  /** Wrap children in this app's shared Button, swapping to pendingLabel while pending — for a
   *  caller that wants the export link styled as a real button instead of plain text/underline. */
  asButton?: boolean;
  buttonVariant?: "primary" | "outline" | "ghost";
}) {
  const [pending, setPending] = useState(false);

  const content = pending ? pendingLabel : children;

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
      {asButton ? (
        <Button type="button" variant={buttonVariant} tabIndex={-1}>
          {content}
        </Button>
      ) : (
        content
      )}
    </a>
  );
}
