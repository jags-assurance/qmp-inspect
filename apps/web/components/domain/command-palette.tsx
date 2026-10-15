"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { NavItem } from "./app-shell";
import { searchEntitiesAction, type EntityHit } from "@/lib/search/actions";

import { filterEntries, flattenNavItems as flatten, type PaletteEntry as Entry } from "@/lib/search/palette-entries";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Header search: Ctrl/Cmd+K (or the header box / the mobile search button) opens a jump-to list over
 * every sidebar destination PLUS a record search (projects, NCR / ITP / inspection numbers and
 * titles — run under the caller's own RLS, see lib/search/actions.ts). Arrow keys + Enter to go,
 * Escape to close; focus stays inside the dialog while it is open.
 */
export function CommandPalette({ navItems }: { navItems: NavItem[] }) {
  const tl = useTranslate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const entries = useMemo(() => flatten(navItems), [navItems]);
  const [hits, setHits] = useState<EntityHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const pageResults = useMemo(() => filterEntries(entries, query), [entries, query]);

  // Record hits (debounced); a stale response from an earlier keystroke is dropped.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
      setHits([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(() => {
      searchEntitiesAction(query)
        .then((found) => {
          if (seq === searchSeq.current) setHits(found);
        })
        .catch(() => {
          if (seq === searchSeq.current) setHits([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [open, query]);

  const results: Entry[] = useMemo(
    () => [...pageResults, ...hits.map((h) => ({ label: h.label, href: h.href, path: `${h.sub} › ${h.label}` }))],
    [pageResults, hits]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setQuery("");
        setActive(0);
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    openerRef.current?.focus?.();
  }

  function go(entry: Entry | undefined) {
    if (!entry) return;
    setOpen(false);
    router.push(entry.href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Tab") {
      // Focus trap: the input is the only tab stop in the dialog (options are reached with arrows).
      e.preventDefault();
    }
  }

  function openPalette(opener: HTMLElement | null) {
    openerRef.current = opener;
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  return (
    <>
      {/* Tablet and up: a search field with the Ctrl K hint. Phones: icon button (below). */}
      <button
        type="button"
        onClick={(e) => openPalette(e.currentTarget)}
        aria-label={tl("Search pages and records (Ctrl+K)")}
        className="hidden h-10 w-44 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted hover:bg-surface-subtle hover:text-ink sm:flex lg:w-56 xl:w-72 [@media(pointer:coarse)]:h-11"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M17 17L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-start"><Tx>Search…</Tx></span>
        <kbd className="hidden rounded border border-border px-1.5 text-xs text-muted [@media(pointer:coarse)]:hidden lg:inline"><Tx>Ctrl K</Tx></kbd>
      </button>

      <button
        type="button"
        onClick={(e) => openPalette(e.currentTarget)}
        aria-label={tl("Search pages and records")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink hover:bg-surface-subtle sm:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M17 17L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Portalled to <body>: the header is a z-20 stacking context, which would cap this z-50 overlay under notices (z-30). */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={tl("Search pages and records")}>
          <div aria-hidden="true" className="absolute inset-0 bg-ink/40" onClick={close} />
          <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder={tl("Type a page name, or an NCR / ITP / inspection number…")}
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={results[active] ? `cp-${active}` : undefined}
              className="min-h-12 w-full border-b border-border bg-surface px-4 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-burgundy sm:text-sm"
            />
            <ul id="command-palette-list" role="listbox" className="max-h-80 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li
                  key={r.href + r.path}
                  id={`cp-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={"cursor-pointer px-4 py-2 text-sm " + (i === active ? "bg-off-white text-burgundy" : "text-ink")}
                >
                  {r.path}
                </li>
              ))}
              {results.length === 0 && <li className="px-4 py-3 text-sm text-muted">{searching ? "Searching…" : "No matching page or record."}</li>}
            </ul>
            <p className="sr-only" role="status" aria-live="polite">
              {searching ? "Searching" : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
