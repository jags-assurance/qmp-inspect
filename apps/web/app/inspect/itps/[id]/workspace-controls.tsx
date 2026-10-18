"use client";

import { useEffect } from "react";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

function openFromHash() {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  if (!hash.startsWith("#activity-")) return;
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return;
  // Open the activity (the target is its list item) and every collapsed section around it, then bring it into view.
  const own = el.querySelector<HTMLDetailsElement>("details[data-activity]");
  if (own) own.open = true;
  let node: HTMLElement | null = el;
  while (node) {
    if (node instanceof HTMLDetailsElement) node.open = true;
    node = node.parentElement;
  }
  el.scrollIntoView({ block: "start", behavior: "smooth" });
}

/**
 * Expand/collapse all activities and sections, and make an in-page link such as "#activity-<id>" (from the
 * outstanding-actions list) open the collapsed activity it points at. Plain DOM on native <details>, so the
 * page itself stays server-rendered and works without JavaScript.
 */
export function WorkspaceControls({ rootId }: { rootId: string }) {
  const tl = useTranslate();
  useEffect(() => {
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  const setAll = (open: boolean) => {
    document.querySelectorAll<HTMLDetailsElement>(`#${rootId} details[data-activity]`).forEach((d) => {
      d.open = open;
    });
  };
  const btn =
    "min-h-8 rounded-md border border-control-border bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-subtle [@media(pointer:coarse)]:min-h-11";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={tl("Activities")}>
      <button type="button" className={btn} onClick={() => setAll(true)}>
        <Tx>Expand all</Tx>
      </button>
      <button type="button" className={btn} onClick={() => setAll(false)}>
        <Tx>Collapse all</Tx>
      </button>
    </div>
  );
}
