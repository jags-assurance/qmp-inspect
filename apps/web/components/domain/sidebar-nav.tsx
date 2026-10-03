"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { NavItem } from "./app-shell";
import { NavIcon } from "./nav-icons";
import { useSidebarMobile } from "./sidebar-mobile-context";

const NAV_STATE_EVENT = "jags-nav-state";

function subscribeNavState(onChange: () => void) {
  window.addEventListener(NAV_STATE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(NAV_STATE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// In-memory mirror so the toggle still works when storage is blocked (it just won't persist).
const memoryNavState = new Map<string, string>();

function readNavState(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memoryNavState.get(key) ?? null;
  } catch {
    return memoryNavState.get(key) ?? null;
  }
}

function writeNavState(key: string, value: string) {
  memoryNavState.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the in-memory mirror above keeps this page load consistent.
  }
  window.dispatchEvent(new Event(NAV_STATE_EVENT));
}

function isItemActive(pathname: string, href: string, activePrefixes: string[] = []): boolean {
  if (activePrefixes.some((p) => pathname.startsWith(p))) return true;
  return href === "/inspect" || href === "/platform" ? pathname === href : pathname.startsWith(href);
}

function NavLink({ item, collapsed, indent = false }: { item: NavItem; collapsed: boolean; indent?: boolean }) {
  const pathname = usePathname();
  const { setOpen } = useSidebarMobile();
  const isActive = isItemActive(pathname, item.href, item.activePrefixes);

  return (
    <a
      href={item.href}
      title={collapsed ? item.label : undefined}
      onClick={() => setOpen(false)}
      className={
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors " +
        (collapsed ? "justify-center px-0" : indent ? "pl-9" : "") +
        " " +
        (isActive ? "bg-white/10 text-gold" : "text-white/85 hover:bg-white/10 hover:text-white")
      }
    >
      {!indent && <NavIcon label={item.label} />}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </a>
  );
}

/** True if this item or, recursively, any of its descendants is the current page — used so a
 *  group nested two levels deep (Settings > Access & Roles > Staff Access) still auto-expands both
 *  ancestor groups on landing, not just the immediate parent. */
function hasActiveDescendant(pathname: string, item: NavItem): boolean {
  if (isItemActive(pathname, item.href, item.activePrefixes)) return true;
  return (item.children ?? []).some((c) => hasActiveDescendant(pathname, c));
}

/**
 * A collapsible group (see NavItem.children's doc comment) — starts expanded only when one of its
 * own children is the current page, so landing on, say, /inspect/organisation/staff-access opens
 * "Organisation Settings" automatically instead of hiding the very item that's active. Otherwise
 * starts collapsed, since these are the admin-setup screens visited far less often than the
 * top-level operational items (Projects/ITPs/NCRs/...) this folds them out from under.
 *
 * Recursive: a child that itself has children renders as a nested NavGroup (indented one level
 * further) instead of a plain link — this is what lets the 6 "Organisation" theme groups fold under
 * one top-level "Settings" entry (plan Phase 8) without flattening their own sub-items.
 */
function NavGroup({ item, collapsed, depth = 0 }: { item: NavItem; collapsed: boolean; depth?: number }) {
  const pathname = usePathname();
  const children = item.children ?? [];
  const hasActiveChild = children.some((c) => hasActiveDescendant(pathname, c));
  // The sidebar's links are full page loads, so plain state resets on every navigation — Settings
  // would snap shut each time. The open/closed choice lives in localStorage (read through
  // useSyncExternalStore so server and first client render agree); with no saved choice, a group
  // opens only when it holds the current page.
  const storageKey = `jags.nav.open.${item.label}`;
  const saved = useSyncExternalStore(
    subscribeNavState,
    () => readNavState(storageKey),
    () => null
  );
  const open = saved === null ? hasActiveChild : saved === "1";

  function toggle() {
    writeNavState(storageKey, open ? "0" : "1");
  }

  if (children.length === 0) return null;

  // A collapsed (icon-only) sidebar has no room for a nested group — fall back to just showing
  // every leaf link flush with the top-level items (recursing through any nested groups too),
  // rather than a group header that can't itself be labelled or expanded in that width.
  if (collapsed) {
    return (
      <>
        {children.map((child) =>
          child.children ? (
            <NavGroup key={child.label} item={child} collapsed={collapsed} />
          ) : (
            <NavLink key={child.href} item={child} collapsed={collapsed} />
          )
        )}
      </>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={depth > 0 ? { paddingLeft: `${12 + depth * 20}px` } : undefined}
        className={
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors " +
          (hasActiveChild ? "text-gold" : "text-white/85 hover:bg-white/10 hover:text-white")
        }
      >
        {depth === 0 && <NavIcon label={item.label} />}
        <span className="flex-1 truncate text-left">{item.label}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={"h-3.5 w-3.5 shrink-0 transition-transform " + (open ? "rotate-90" : "")}
        >
          <path d="M7 4.5l5.5 5.5-5.5 5.5" />
        </svg>
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {children.map((child) =>
            child.children ? (
              <NavGroup key={child.label} item={child} collapsed={collapsed} depth={depth + 1} />
            ) : (
              <NavLink key={child.href} item={child} collapsed={collapsed} indent />
            )
          )}
        </div>
      )}
    </div>
  );
}

export function SidebarNav({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  return (
    <nav className="flex-1 space-y-1 px-3">
      {items.map((item) =>
        item.children ? (
          <NavGroup key={item.label} item={item} collapsed={collapsed} />
        ) : (
          <NavLink key={item.href} item={item} collapsed={collapsed} />
        )
      )}
    </nav>
  );
}
