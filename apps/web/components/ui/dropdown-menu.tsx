"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Minimal, dependency-free dropdown — a trigger button that toggles a small absolutely-positioned
 * panel of arbitrary content (links, forms, buttons), closed on outside click, Escape, or clicking
 * any item inside it. Built for the ITP detail page's document actions (View/Download/Regenerate
 * PDF, offline .xlsx, Word) so a page with one action per format reads as "more options for this
 * document" instead of a wall of equally-weighted buttons — see that page's own comment for the
 * before/after. No aria role="menu" semantics (the panel holds real forms/links, which a true menu
 * role doesn't support well) — just a labelled, dismissible disclosure region, same pattern this
 * app already uses for e.g. NotificationsBell.
 */
export function DropdownMenu({
  label,
  children,
  align = "start",
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
      >
        {label}
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
          <path d="M5.5 8l4.5 4.5L14.5 8" />
        </svg>
      </button>
      {open && (
        // Closes on any click inside (a link navigating, a form submitting, a plain button) — the
        // menu re-closing is the right default for every item it currently holds; a future item
        // that needs to stay open after its own click can stopPropagation() on itself.
        //
        // Deferred via setTimeout(0), not called synchronously: a real bug found live — closing
        // synchronously in this bubble-phase handler unmounts the clicked <a>/<form> before the
        // browser's native "activation behavior" (the anchor's navigation, or the submit button's
        // form submission) had actually fired, silently swallowing the click entirely — Generate PDF,
        // the .xlsx export, and the Word export all did nothing because of this exact race. Letting
        // the native action fire first, then closing on the next tick, fixes all of them at once.
        <div
          onClick={() => setTimeout(() => setOpen(false), 0)}
          className={
            "absolute z-20 mt-1 min-w-[14rem] overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg " +
            (align === "end" ? "end-0" : "start-0")
          }
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** One row inside a DropdownMenu — same visual weight whether it wraps an <a>, a <Link>, or a form's submit button. */
export function DropdownMenuItem({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={"block px-1 py-0.5 text-sm [&_a]:block [&_a]:w-full [&_a]:px-3 [&_a]:py-2 [&_a]:hover:bg-off-white [&_button]:w-full [&_button]:px-3 [&_button]:py-2 [&_button]:text-start [&_button]:hover:bg-off-white " + className}>{children}</div>;
}
