"use client";

import { usePathname } from "next/navigation";
import type { NavItem } from "./app-shell";
import { NavIcon } from "./nav-icons";
import { useSidebarMobile } from "./sidebar-mobile-context";

export function SidebarNav({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  const pathname = usePathname();
  const { setOpen } = useSidebarMobile();

  return (
    <nav className="flex-1 space-y-1 px-3">
      {items.map((item) => {
        const isActive = item.href === "/inspect" || item.href === "/platform"
          ? pathname === item.href
          : pathname.startsWith(item.href);

        return (
          <a
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            onClick={() => setOpen(false)}
            className={
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors " +
              (collapsed ? "justify-center px-0" : "") +
              " " +
              (isActive ? "bg-white/10 text-gold" : "text-white/85 hover:bg-white/10 hover:text-white")
            }
          >
            <NavIcon label={item.label} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </a>
        );
      })}
    </nav>
  );
}
