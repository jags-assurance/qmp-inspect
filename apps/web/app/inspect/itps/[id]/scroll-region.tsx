"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Horizontal scroll region for the sign-off grid (tablet widths). Only the scroll affordance lives
 * here: a right-edge fade that disappears once the user has scrolled to the end (or when nothing
 * overflows). Below md the region does not scroll and the fade is never shown.
 */
export function ScrollRegion({ children, labelledBy, fade = true }: { children: ReactNode; labelledBy: string; fade?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const dir = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    const scrolled = Math.abs(el.scrollLeft) * dir;
    setMore(el.scrollWidth - el.clientWidth - Math.abs(scrolled) > 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="relative">
      <div ref={ref} onScroll={measure} role="region" aria-labelledby={labelledBy} tabIndex={0} className="md:overflow-x-auto md:overscroll-x-contain">
        {children}
      </div>
      {fade && more && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-0 hidden w-8 bg-gradient-to-l from-surface to-transparent md:block xl:hidden" />
      )}
    </div>
  );
}
