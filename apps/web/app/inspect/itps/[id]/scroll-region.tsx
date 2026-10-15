"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Horizontal scroll region for the sign-off grid. Only the scroll affordance lives here: a right-edge
 * fade that disappears once the user has scrolled to the end (or when nothing overflows), an optional
 * hint line and the keyboard tab stop, both of which exist only while the grid really overflows (at
 * any width from md up, whatever the party count). Below md the region does not scroll.
 */
export function ScrollRegion({ children, labelledBy, fade = true, hint }: { children: ReactNode; labelledBy: string; fade?: boolean; hint?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const dir = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    const scrolled = Math.abs(el.scrollLeft) * dir;
    setOverflowing(el.scrollWidth - el.clientWidth > 4);
    setScrolled(Math.abs(scrolled) > 2);
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
    <div className="group/scroll relative" data-overflowing={overflowing} data-scrolled={scrolled}>
      {overflowing && hint}
      {/* When the grid overflows sideways the region also scrolls vertically (a sticky header cannot escape an overflow container), so the party header stays pinned at its top. When it fits there is no overflow container and the header sticks to the viewport below the app header and jump bar. */}
      <div
        ref={ref}
        onScroll={measure}
        role="region"
        aria-labelledby={labelledBy}
        tabIndex={overflowing ? 0 : undefined}
        className={overflowing ? "md:max-h-[calc(100dvh-var(--header-h)-var(--jump-h)-1rem)] md:overflow-auto md:overscroll-x-contain" : undefined}
      >
        {children}
      </div>
      {fade && more && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-0 hidden w-8 bg-gradient-to-l from-surface to-transparent md:block" />
      )}
    </div>
  );
}
