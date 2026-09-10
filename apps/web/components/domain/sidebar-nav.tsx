"use client";

import { usePathname } from "next/navigation";
import type { NavItem } from "./app-shell";

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

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
            className={
              "block rounded-md px-3 py-2 text-sm font-medium transition-colors " +
              (isActive ? "bg-white/10 text-gold" : "text-white/85 hover:bg-white/10 hover:text-white")
            }
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
