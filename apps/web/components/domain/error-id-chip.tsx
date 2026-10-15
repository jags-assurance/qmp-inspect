"use client";

import { useState } from "react";
import { Tx } from "@/components/domain/tx";

/** The error reference as a copyable chip: tap to copy, with a text confirmation (not colour only). */
export function ErrorIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(id).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            },
            () => {
              /* permission denied or insecure context: the ID stays visible and selectable */
            }
          );
        } catch {
          /* clipboard unavailable: the ID stays visible and selectable */
        }
      }}
      title={id}
      className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-control-border bg-surface-subtle px-3 text-xs text-ink hover:bg-surface-sunken"
    >
      <span className="text-muted"><Tx>Error ID</Tx></span>
      <span className="truncate font-mono select-all">{id}</span>
      <span aria-live="polite" className="shrink-0 font-medium text-brand">
        {copied ? <Tx>Copied</Tx> : <Tx>Copy</Tx>}
      </span>
    </button>
  );
}
