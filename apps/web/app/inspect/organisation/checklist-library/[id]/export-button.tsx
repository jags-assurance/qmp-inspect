"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";

/**
 * Real gap found in a UX audit: this was a plain `<a href>` to a synchronous export route with zero
 * visual feedback while the server generated the file — nothing but the browser's own easy-to-miss
 * tab spinner for however long that took, and nothing discouraging a re-click. A direct file-download
 * link never fires a JS "done" event we can hook, so this reverts on a short timer rather than a real
 * completion signal — long enough to cover normal generation time, short enough that a slow network
 * doesn't leave the button stuck disabled forever.
 */
export function ExportButton({ templateId }: { templateId: string }) {
  const [pending, setPending] = useState(false);

  return (
    <a
      href={`/api/checklist-library/${templateId}/export`}
      onClick={() => {
        setPending(true);
        setTimeout(() => setPending(false), 4000);
      }}
      aria-disabled={pending}
      className={buttonVariants({ variant: "outline" })}
    >
      {pending ? "Preparing…" : "Download .xlsx →"}
    </a>
  );
}
