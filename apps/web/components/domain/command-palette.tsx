"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { NavItem } from "./app-shell";

interface Entry {
  label: string;
  href: string;
  path: string;
}

/** Every real destination in the sidebar (leaves only), with its group path for context —
 *  "Settings › Access & Roles › Staff Access" — so the ~17 nested admin pages are one search away. */
function flatten(items: NavItem[], trail: string[] = []): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      out.push(...flatten(item.children, [...trail, item.label]));
    } else {
      if (item.palette) out.push(...flatten(item.palette, [...trail, item.label]));
      out.push({ label: item.label, href: item.href, path: [...trail, item.label].join(" › ") });
    }
  }
  return out;
}

/**
 * Header search that actually works: Ctrl/Cmd+K (or clicking the box) opens a jump-to-page list over
 * every sidebar destination, arrow keys + Enter to go. Replaces a search input that did nothing.
 */
export function CommandPalette({ navItems }: { navItems: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const entries = useMemo(() => flatten(navItems), [navItems]);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return entries;
    return entries.filter((e) => terms.every((t) => e.path.toLowerCase().includes(t)));
  }, [entries, query]);

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
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          openerRef.current = e.currentTarget;
          setQuery("");
          setActive(0);
          setOpen(true);
        }}
        className="relative hidden min-h-9 w-full max-w-xs items-center rounded-md border border-border bg-off-white py-1.5 pl-9 pr-3 text-left text-sm text-muted hover:border-burgundy sm:flex"
        aria-label="Jump to a page (Ctrl+K)"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M17 17L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="flex-1">Jump to a page…</span>
        <kbd className="rounded border border-border px-1 text-[10px]">Ctrl K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Jump to a page">
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
              placeholder="Type a page name…"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={results[active] ? `cp-${active}` : undefined}
              className="min-h-12 w-full border-b border-border bg-surface px-4 text-sm text-ink outline-none"
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
              {results.length === 0 && <li className="px-4 py-3 text-sm text-muted">No matching page.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
