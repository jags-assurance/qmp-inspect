"use client";

import { useSidebarMobile } from "./sidebar-mobile-context";

/** Hamburger button, visible only below 1024px (tablet and phone) where the sidebar is an off-canvas drawer. */
export function MobileSidebarToggle() {
  const { open, setOpen } = useSidebarMobile();

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-controls="app-sidebar"
      data-sidebar-toggle
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-surface-subtle -ms-2 sm:-ms-1 lg:hidden"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-5 w-5">
        {open ? (
          <path d="M5 5l10 10M15 5L5 15" />
        ) : (
          <>
            <path d="M3 5.5h14" />
            <path d="M3 10h14" />
            <path d="M3 14.5h14" />
          </>
        )}
      </svg>
    </button>
  );
}
