"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A sideways-scrolling list that brings the current item (the link marked aria-current) into view
 * after each render, so on a phone the active settings section is never hidden off-screen.
 * Scrolls only this list horizontally; the page does not move.
 */
export function ScrollRow({ className, label, children }: { className?: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = ref.current;
    const item = list?.querySelector("[aria-current]")?.closest("li") as HTMLElement | null | undefined;
    if (!list || !item) return;
    list.scrollLeft = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
  });
  return (
    <ul ref={ref} className={`relative ${className ?? ""}`} aria-label={label}>
      {children}
    </ul>
  );
}
