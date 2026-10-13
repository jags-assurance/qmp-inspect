"use client";

import { useEffect, useState } from "react";
import { previewNextNumberAction } from "@/lib/numbering/preview-actions";
import { Tx } from "@/components/domain/tx";

/**
 * "Next number: X" under a creation form. `id` is the project id (itp, ncr) or the inspection record id
 * (irn). It is only a preview: the real number is allocated when the form is saved.
 */
export function NextNumberHint({ kind, id }: { kind: "itp" | "ncr" | "irn"; id: string }) {
  const [shown, setShown] = useState<{ key: string; value: string | null } | null>(null);
  const key = `${kind}:${id}`;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    previewNextNumberAction(kind, id).then((value) => {
      if (!cancelled) setShown({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, id, key]);

  if (!id || shown?.key !== key || !shown.value) return null;
  return (
    <p className="mt-1 text-xs text-muted" aria-live="polite">
      <Tx>Next number (assigned when saved):</Tx> <span className="font-mono text-ink">{shown.value}</span>
    </p>
  );
}
