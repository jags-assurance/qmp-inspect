"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./app-shell";
import { NavIcon } from "./nav-icons";
import { useSidebarMobile } from "./sidebar-mobile-context";
import { useTranslate } from "@/lib/i18n/locale-context";

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

/**
 * `collapsed` is the rail PREFERENCE: markup carries both layouts and `lg:max-desk:` utilities (laptop
 * range only) switch to the icon rail, so the server render and first paint are right at every width.
 * `railActive` is the JS view of "rail is showing now" (only used for the hover tooltip).
 */
function NavLink({ item, collapsed, railActive = false, indent = false }: { item: NavItem; collapsed: boolean; railActive?: boolean; indent?: boolean }) {
  const pathname = usePathname();
  const { setOpen } = useSidebarMobile();
  const isActive = isItemActive(pathname, item.href, item.activePrefixes);
  const text = item.displayLabel ?? item.label;
  // Icon-rail tooltip: rendered in a portal (the sidebar scrolls, which would clip an absolute tooltip).
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  function showTip(el: HTMLElement) {
    if (!railActive) return;
    const rect = el.getBoundingClientRect();
    setTip({ top: rect.top + rect.height / 2, left: rect.right + 8 });
  }

  return (
    // next/link: client-side navigation (no full reload). Prefetch is off: ~25 links would otherwise each
    // fire a prefetch through the proxy. Active state comes from usePathname().
    <>
      <Link
        href={item.href}
        prefetch={false}
        aria-label={railActive ? text : undefined}
        title={railActive ? undefined : text}
        aria-current={isActive ? "page" : undefined}
        onClick={() => {
          setTip(null);
          setOpen(false);
        }}
        onMouseEnter={(e) => showTip(e.currentTarget)}
        onMouseLeave={() => setTip(null)}
        onFocus={(e) => showTip(e.currentTarget)}
        onBlur={() => setTip(null)}
        className={
          "relative flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [@media(pointer:coarse)]:min-h-11 " +
          (indent ? "ps-9 " : "") +
          (collapsed ? "lg:max-desk:justify-center lg:max-desk:px-0 " + (indent ? "lg:max-desk:ps-0 " : "") : "") +
          (isActive
            ? "bg-white/15 text-white before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:rounded-full before:bg-gold"
            : "text-white/85 hover:bg-white/10 hover:text-white")
        }
      >
        {/* Nested rows show no icon when expanded, but need one in the rail. */}
        <span className={(isActive ? "text-gold " : "") + (indent ? (collapsed ? "hidden lg:max-desk:inline " : "hidden ") : "")}><NavIcon label={item.label} /></span>
        <span className={"min-w-0 flex-1 truncate " + (collapsed ? "lg:max-desk:hidden" : "")}>{text}</span>
        {item.badge !== undefined && item.badge !== 0 && (
          <>
            {collapsed && <span aria-hidden="true" className="absolute end-2 top-1.5 hidden h-2 w-2 rounded-full bg-gold lg:max-desk:block" />}
            <span className={"ms-auto shrink-0 rounded-full bg-gold px-1.5 text-xs font-semibold leading-5 text-burgundy-dark " + (collapsed ? "lg:max-desk:hidden" : "")}>{item.badge}</span>
          </>
        )}
      </Link>
      {railActive && tip && typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", top: tip.top, left: tip.left, transform: "translateY(-50%)" }}
            className="pointer-events-none z-50 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
          >
            {text}
          </span>,
          document.body
        )}
    </>
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
function NavGroup({ item, collapsed, railActive, depth = 0 }: { item: NavItem; collapsed: boolean; railActive: boolean; depth?: number }) {
  const pathname = usePathname();
  const children = item.children ?? [];
  const hasActiveChild = children.some((c) => hasActiveDescendant(pathname, c));
  // The open/closed choice lives in localStorage so it survives reloads and the sidebar remounting
  // (read through
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

  // In the icon rail (collapsed preference, laptop widths only) a group header cannot be labelled or
  // expanded, so its header is hidden and every leaf shows flush with the top-level items.
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={item.displayLabel ?? item.label}
        style={depth > 0 ? { paddingInlineStart: `${12 + depth * 20}px` } : undefined}
        className={
          "flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [@media(pointer:coarse)]:min-h-11 " +
          (collapsed ? "lg:max-desk:hidden " : "") +
          (hasActiveChild ? "text-white" : "text-white/85 hover:bg-white/10 hover:text-white")
        }
      >
        {depth === 0 && <NavIcon label={item.label} />}
        <span className="flex-1 truncate text-start">{item.displayLabel ?? item.label}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={"h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none rtl:-scale-x-100 " + (open ? "rotate-90" : "")}
        >
          <path d="M7 4.5l5.5 5.5-5.5 5.5" />
        </svg>
      </button>
      <div className={"mt-0.5 space-y-0.5 " + (open ? "" : "hidden ") + (collapsed ? "lg:max-desk:block" : "")}>
        {children.map((child) =>
          child.children ? (
            <NavGroup key={child.label} item={child} collapsed={collapsed} railActive={railActive} depth={depth + 1} />
          ) : (
            <NavLink key={child.href} item={child} collapsed={collapsed} railActive={railActive} indent />
          )
        )}
      </div>
    </div>
  );
}

/** `collapsed` = rail preference (CSS applies it on laptops only); `railActive` = the rail is showing right now (tooltips). */
/**
 * A foldable section heading (Plan, Quality, ...): the heading is a button with a chevron, so people can see it
 * folds. Starts open, remembers the choice, never hides the page you are on, and shows how many links it holds
 * while folded. In the icon rail headings are hidden and every link stays visible.
 */
function NavSection({ label, items, collapsed, railActive }: { label: string; items: NavItem[]; collapsed: boolean; railActive: boolean }) {
  const pathname = usePathname();
  const hasActive = items.some((i) => hasActiveDescendant(pathname, i));
  const storageKey = `jags.nav.section.${label}`;
  const saved = useSyncExternalStore(
    subscribeNavState,
    () => readNavState(storageKey),
    () => null
  );
  const open = hasActive || saved !== "0";
  const badge = items.reduce((n, i) => n + (typeof i.badge === "number" ? i.badge : 0), 0);
  return (
    <div>
      {collapsed && <div role="separator" className="mx-3 my-2 hidden border-t border-white/15 first:hidden lg:max-desk:block" />}
      <button
        type="button"
        onClick={() => writeNavState(storageKey, open ? "0" : "1")}
        aria-expanded={open}
        className={"mt-3 flex min-h-9 w-full items-center gap-1.5 rounded-md px-3 text-xs font-semibold uppercase tracking-wider text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [@media(pointer:coarse)]:min-h-11 " + (collapsed ? "lg:max-desk:hidden" : "")}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={"h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none " + (open ? "" : "-rotate-90 rtl:rotate-90")}>
          <path d="M5 7.5l5 5 5-5" />
        </svg>
        <span className="flex-1 truncate text-start">{label}</span>
        {!open && (
          <span className="rounded-full bg-white/20 px-1.5 text-[11px] font-medium normal-case leading-5 tracking-normal text-white">
            {items.length}{badge > 0 ? ` · ${badge}` : ""}
          </span>
        )}
      </button>
      <div className={"mt-0.5 space-y-0.5 " + (open ? "" : "hidden ") + (collapsed ? "lg:max-desk:block" : "")}>
        {items.map((item) =>
          item.children ? (
            <NavGroup key={item.label + item.href} item={item} collapsed={collapsed} railActive={railActive} />
          ) : (
            <NavLink key={item.label + item.href} item={item} collapsed={collapsed} railActive={railActive} />
          )
        )}
      </div>
    </div>
  );
}

/** `collapsed` = rail preference (CSS applies it on laptops only); `railActive` = the rail is showing right now (tooltips). */
export function SidebarNav({ items, collapsed, railActive = false }: { items: NavItem[]; collapsed: boolean; railActive?: boolean }) {
  const tl = useTranslate();
  // Consecutive items sharing a group become one foldable section; ungrouped items stand alone.
  const segments: { group: string | null; label: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const last = segments[segments.length - 1];
    if (item.group && last && last.group === item.group) last.items.push(item);
    else segments.push({ group: item.group ?? null, label: item.displayGroup ?? item.group ?? "", items: [item] });
  }
  return (
    <nav aria-label={tl("Main")} className="flex-1 space-y-0.5 px-3 py-3">
      {segments.map((seg, i) =>
        seg.group ? (
          <NavSection key={seg.group + i} label={seg.label} items={seg.items} collapsed={collapsed} railActive={railActive} />
        ) : (
          seg.items.map((item) => (
            <div key={item.label + item.href}>
              {item.children ? (
                <NavGroup item={item} collapsed={collapsed} railActive={railActive} />
              ) : (
                <NavLink item={item} collapsed={collapsed} railActive={railActive} />
              )}
            </div>
          ))
        )
      )}
    </nav>
  );
}
