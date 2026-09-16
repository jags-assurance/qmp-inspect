"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

const SidebarMobileCtx = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

/**
 * Below ~900px the sidebar becomes a true off-canvas drawer (closed by default) instead of the
 * permanently-visible column it is on desktop — this context is the shared open/close state between
 * the header's hamburger button and SidebarShell, which are siblings under AppShell (a server
 * component), so plain prop-drilling from one to the other isn't an option.
 */
export function SidebarMobileProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <SidebarMobileCtx.Provider value={{ open, setOpen }}>{children}</SidebarMobileCtx.Provider>;
}

export function useSidebarMobile() {
  const ctx = useContext(SidebarMobileCtx);
  if (!ctx) throw new Error("useSidebarMobile must be used within SidebarMobileProvider");
  return ctx;
}
