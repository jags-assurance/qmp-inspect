"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Tx } from "@/components/domain/tx";

/**
 * A small "Guide" button next to a page's own <h1> — click-to-open, not always-on text, so it
 * doesn't compete with the page's real content but is still one click away on every page that has
 * one. Same click-outside-to-close pattern as NotificationsBell. Deliberately per-page and written
 * fresh for each page's own real mechanics (who can do what here, specifically) rather than a
 * generic "here's what this page is" blurb — see app/inspect/guide/page.tsx for the app-wide
 * equivalent this links back to.
 */
export function PageGuide({
  title,
  points,
  linkToAppGuide = true,
}: {
  title: string;
  points: string[];
  linkToAppGuide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3.5 [@media(pointer:coarse)]:text-sm hover:border-burgundy/40 hover:text-burgundy"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
          <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 8a2 2 0 1 1 2.6 1.9c-.5.2-.9.6-.9 1.1v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="13.8" r=".9" fill="currentColor" stroke="none" />
        </svg>
        <Tx>Guide</Tx>
      </button>

      {open && (
        <div className="absolute start-0 top-9 z-20 w-80 max-sm:fixed max-sm:inset-x-4 max-sm:top-24 max-sm:w-auto max-sm:max-h-[70vh] max-sm:overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-lg sm:w-96">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <ul className="mt-2 list-disc space-y-1.5 ps-4 text-xs text-ink [@media(pointer:coarse)]:text-sm">
            {points.map((p, i) => (
              <li key={i}><Tx>{p}</Tx></li>
            ))}
          </ul>
          {linkToAppGuide && (
            <Link
              href="/inspect/guide"
              className="mt-3 inline-flex min-h-8 items-center text-xs [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-sm font-medium text-burgundy hover:underline"
              onClick={() => setOpen(false)}
            >
              <Tx>Full app guide →</Tx>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
