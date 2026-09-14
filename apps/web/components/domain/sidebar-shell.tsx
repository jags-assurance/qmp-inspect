"use client";

import { useEffect, useState } from "react";
import type { NavItem } from "./app-shell";
import { SidebarNav } from "./sidebar-nav";

const STORAGE_KEY = "jags-sidebar-collapsed";

/**
 * Owns the sidebar's collapse/expand state (persisted per-browser via localStorage — a per-viewer
 * UI preference, not data, so this is the right place for it per the app's own conventions) and its
 * sticky positioning. Split out from AppShell (a server component) because this needs client-side
 * state; AppShell still owns the header/breadcrumb/search and passes the sign-out form in as a
 * server action reference, which Next.js allows across the server/client boundary.
 */
export function SidebarShell({
  navItems,
  userName,
  userRole,
  signOutAction,
}: {
  navItems: NavItem[];
  userName: string;
  userRole: string;
  signOutAction: (formData: FormData) => void | Promise<void>;
}) {
  // Starts expanded on the server and on first client paint (matches SSR markup, no hydration
  // mismatch — the same discipline as offline-banner.tsx elsewhere in this app), then reads the
  // real stored preference in an effect once mounted.
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private browsing / storage blocked — just stays expanded.
    }
    setMounted(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Nothing to persist to — the toggle still works for this page view.
      }
      return next;
    });
  }

  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside
      className={
        "sticky top-0 flex h-screen self-start shrink-0 flex-col overflow-y-auto bg-burgundy text-white transition-all duration-150 " +
        (collapsed ? "w-16" : "w-60") +
        // Avoids a flash of the wrong width on first paint while the effect above hasn't run yet.
        (mounted ? "" : " duration-0")
      }
    >
      <div className={"flex items-center gap-2 px-4 py-5 " + (collapsed ? "justify-center px-2" : "")}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-gold text-sm font-semibold">
          JA
        </div>
        {!collapsed && <span className="truncate font-semibold tracking-wide">JAGS Assurance</span>}
      </div>

      <SidebarNav items={navItems} collapsed={collapsed} />

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white " +
            (collapsed ? "justify-center px-0" : "")
          }
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={"h-4 w-4 shrink-0 transition-transform " + (collapsed ? "rotate-180" : "")}
          >
            <path d="M12.5 4.5L7 10l5.5 5.5" />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>

      <div className={"border-t border-white/15 px-4 py-4 " + (collapsed ? "px-2 text-center" : "")}>
        {collapsed ? (
          <div
            title={`${userName} · ${userRole}`}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold"
          >
            {initials}
          </div>
        ) : (
          <>
            <div className="text-sm font-medium">{userName}</div>
            <div className="text-xs text-white/70">{userRole}</div>
          </>
        )}
        <form action={signOutAction} className={collapsed ? "mt-2 flex justify-center" : ""}>
          <button
            type="submit"
            title="Sign out"
            className={
              collapsed
                ? "flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
                : "mt-2 text-xs text-white/70 hover:text-white hover:underline"
            }
          >
            {collapsed ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M8 3.5H5a1.5 1.5 0 00-1.5 1.5v10A1.5 1.5 0 005 16.5h3" />
                <path d="M13 13.5l3.5-3.5L13 6.5" />
                <path d="M16.5 10h-9" />
              </svg>
            ) : (
              "Sign out"
            )}
          </button>
        </form>
      </div>
    </aside>
  );
}
