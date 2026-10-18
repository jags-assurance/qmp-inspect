"use client";

import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Expand or collapse every section of the ITP. Plain DOM on native <details>, so the
 * page itself stays server-rendered and works without JavaScript.
 */
export function WorkspaceControls({ rootId }: { rootId: string }) {
  const tl = useTranslate();
  const setAll = (open: boolean) => {
    document.querySelectorAll<HTMLDetailsElement>(`#${rootId} details[data-section]`).forEach((d) => {
      d.open = open;
    });
  };
  const btn =
    "min-h-8 rounded-md border border-control-border bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-subtle [@media(pointer:coarse)]:min-h-11";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={tl("Sections")}>
      <button type="button" className={btn} onClick={() => setAll(true)}>
        <Tx>Expand all sections</Tx>
      </button>
      <button type="button" className={btn} onClick={() => setAll(false)}>
        <Tx>Collapse all sections</Tx>
      </button>
    </div>
  );
}
