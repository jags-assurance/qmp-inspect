"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { setLocaleAction } from "@/lib/i18n/actions";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/lib/i18n/direction";

/**
 * The top-right profile control. A real menu (not a static badge): shows who is signed in and their
 * role, links to the places a person manages their own context, and signs out. Closes on outside
 * click, Escape, or choosing an item — the standard account-menu behaviour.
 */
export function UserMenu({
  userName,
  userRole,
  signOutAction,
  links = [],
}: {
  userName: string;
  userRole: string;
  signOutAction: () => Promise<void>;
  links?: { label: string; href: string }[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2 rounded-full py-1 ps-1 pe-2 hover:bg-off-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-burgundy sm:pe-3"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-burgundy text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-start leading-tight sm:block">
          <span className="block text-sm font-medium text-ink">{userName}</span>
          <span className="block text-xs text-muted">{userRole}</span>
        </span>
        <span aria-hidden="true" className="hidden text-xs text-muted sm:inline">
          ▾
        </span>
      </button>

      {open && (
        <div role="menu" className="absolute end-0 z-30 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium text-ink">{userName}</p>
            <p className="text-xs text-muted">{userRole}</p>
          </div>
          {links.length > 0 && (
            <ul className="py-1">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="block px-4 py-2.5 text-sm text-ink hover:bg-off-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <form action={setLocaleAction} className="flex items-center gap-2 border-t border-border px-4 py-2.5" aria-label="Language">
            <span className="text-xs text-muted">Language</span>
            {SUPPORTED_LOCALES.map((code) => (
              <button
                key={code}
                type="submit"
                name="locale"
                value={code}
                role="menuitem"
                lang={code}
                className="min-h-8 rounded-md border border-border px-2 text-xs text-ink hover:bg-off-white"
              >
                {LOCALE_LABELS[code]}
              </button>
            ))}
          </form>
          <form action={signOutAction} className="border-t border-border">
            <button type="submit" role="menuitem" className="block w-full px-4 py-2.5 text-start text-sm font-medium text-danger hover:bg-off-white">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
