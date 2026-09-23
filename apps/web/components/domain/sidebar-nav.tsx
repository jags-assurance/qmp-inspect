"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import type { NavItem } from "./app-shell";
import { NavIcon } from "./nav-icons";
import { useSidebarMobile } from "./sidebar-mobile-context";

function isItemActive(pathname: string, href: string): boolean {
  return href === "/inspect" || href === "/platform" ? pathname === href : pathname.startsWith(href);
}

function NavLink({ item, collapsed, indent = false }: { item: NavItem; collapsed: boolean; indent?: boolean }) {
  const pathname = usePathname();
  const { setOpen } = useSidebarMobile();
  const isActive = isItemActive(pathname, item.href);

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

/**
 * A collapsible group (see NavItem.children's doc comment) — starts expanded only when one of its
 * own children is the current page, so landing on, say, /inspect/organisation/staff-access opens
 * "Organisation Settings" automatically instead of hiding the very item that's active. Otherwise
 * starts collapsed, since these are the admin-setup screens visited far less often than the
 * top-level operational items (Projects/ITPs/NCRs/...) this folds them out from under.
 */
function NavGroup({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const children = item.children ?? [];
  const hasActiveChild = children.some((c) => isItemActive(pathname, c.href));
  const [open, setOpen] = useState(hasActiveChild);

  if (children.length === 0) return null;

  // A collapsed (icon-only) sidebar has no room for a nested group — fall back to just showing
  // every child as its own icon, flush with the top-level items, rather than a group header that
  // can't itself be labelled or expanded in that width.
  if (collapsed) {
    return (
      <>
        {children.map((child) => (
          <NavLink key={child.href} item={child} collapsed={collapsed} />
        ))}
      </>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors " +
          (hasActiveChild ? "text-gold" : "text-white/85 hover:bg-white/10 hover:text-white")
        }
      >
        <NavIcon label={item.label} />
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
          {children.map((child) => (
            <NavLink key={child.href} item={child} collapsed={collapsed} indent />
          ))}
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
