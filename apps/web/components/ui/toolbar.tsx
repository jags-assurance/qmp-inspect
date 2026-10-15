"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

/** A plain left/right row for list-page tools (search + actions). Wraps on narrow screens. */
export function Toolbar({ start, end, className }: { start?: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      {start && <div className="flex min-w-0 flex-wrap items-center gap-2">{start}</div>}
      {end && <div className="ms-auto flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

/**
 * The filter strip above a list. From md the `filters` render inline in a single wrapping row inside
 * a bordered bar. Below md they collapse behind a "Filters" button (with a count of active filters)
 * and open as a bottom sheet, so a phone sees one clean row instead of five stacked selects.
 *
 * The filter controls are rendered ONCE (the same DOM node is an inline row on md+ and the sheet body
 * below md), so ids and form state never duplicate. Pass a <form method="get"> as `filters` and put
 * its submit button inside it; the sheet closes itself when the URL changes. `search` stays visible
 * at every width. `actions` (export, view toggle) sit at the end of the bar.
 */
export function FilterBar({
  search,
  filters,
  actions,
  activeCount = 0,
  clearHref,
  className,
}: {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  /** Number of filters currently applied: shown on the mobile button; enables the Clear link. */
  activeCount?: number;
  clearHref?: string;
  className?: string;
}) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  useFocusTrap(panelRef, open, () => setOpen(false));

  // Navigating (filters applied) closes the phone sheet.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on URL change
    setOpen(false);
  }, [pathname, params]);

  // Growing past md while the sheet is open turns it into the inline row: drop the modal state.
  useEffect(() => {
    if (!open) return;
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => e.matches && setOpen(false);
    mql.addEventListener("change", onChange);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      mql.removeEventListener("change", onChange);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className={cn("no-print rounded-lg border border-border bg-surface p-3 shadow-xs", className)}>
      <div className="flex flex-wrap items-end gap-3">
        {search && <div className="min-w-0 flex-1 basis-56 md:max-w-sm">{search}</div>}
        {filters && (
          <Button
            type="button"
            variant="outline"
            className="md:hidden"
            aria-expanded={open}
            aria-controls={`${titleId}-panel`}
            onClick={() => setOpen(true)}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-4 w-4">
              <path d="M3 5.5h14M6 10h8M8.5 14.5h3" />
            </svg>
            {tl("Filters")}
            {activeCount > 0 && (
              <span className="rounded-full bg-brand px-1.5 text-xs font-semibold leading-5 text-white">{activeCount}</span>
            )}
          </Button>
        )}
        {filters && open && <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default bg-overlay md:hidden" />}
        {filters && (
          <div
            id={`${titleId}-panel`}
            ref={panelRef}
            role={open ? "dialog" : undefined}
            aria-modal={open ? true : undefined}
            aria-labelledby={open ? titleId : undefined}
            tabIndex={-1}
            className={cn(
              open
                ? "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-t-xl border border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl outline-none"
                : "hidden",
              "md:static md:z-auto md:flex md:max-h-none md:flex-1 md:flex-row md:flex-wrap md:items-end md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none"
            )}
          >
            {open && (
              <div className="flex items-center justify-between md:hidden">
                <h2 id={titleId} className="text-base font-semibold text-ink">{tl("Filters")}</h2>
                <button type="button" onClick={() => setOpen(false)} aria-label={tl("Close")} className="-me-2 flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-surface-subtle">
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-5 w-5">
                    <path d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
              </div>
            )}
            {filters}
            {activeCount > 0 && clearHref && (
              <Link href={clearHref} className="inline-flex min-h-10 items-center text-sm font-medium text-brand hover:underline [@media(pointer:coarse)]:min-h-11">
                {tl("Clear all")}
              </Link>
            )}
          </div>
        )}
        {actions && <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Label + control stack for one filter inside a FilterBar (label above, full width on phones). */
export function FilterField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs font-medium text-muted md:w-auto", className)}>
      {label}
      {children}
    </label>
  );
}
