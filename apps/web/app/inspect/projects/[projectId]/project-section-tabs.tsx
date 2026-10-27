"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tab = { id: string; label: string };
const Ctx = createContext<string>("");

/**
 * The project page used to be one long scroll of every section. This puts a row of section names on top:
 * pick one and only that section shows. All sections stay mounted (just hidden), so nothing typed in one is
 * lost when you look at another, and the URL hash (#parties) lets a link open a section directly.
 */
export function ProjectSectionTabs({ tabs, children }: { tabs: Tab[]; children: ReactNode }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL hash after mount
    if (tabs.some((t) => t.id === h)) setActive(h);
  }, [tabs]);

  function choose(id: string) {
    setActive(id);
    try {
      history.replaceState(null, "", `#${id}`);
    } catch {
      /* ignore */
    }
  }

  return (
    <Ctx.Provider value={active}>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Project sections" className="no-print mt-6 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => choose(t.id)}
              className={cn(
                "min-h-11 shrink-0 border-b-2 px-4 text-sm font-medium",
                active === t.id ? "border-burgundy text-burgundy" : "border-transparent text-muted hover:text-ink"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

export function ProjectSectionPanel({ id, children }: { id: string; children: ReactNode }) {
  const active = useContext(Ctx);
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={active !== id}>
      {children}
    </div>
  );
}
