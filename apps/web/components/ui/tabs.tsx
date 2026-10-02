"use client";

import { useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Active tab kept in the URL (`?<param>=<key>`) so a tab is linkable, survives refresh and Back
 * returns to the previous one. Falls back to the first tab for a missing/unknown value.
 */
export function useUrlTab<K extends string>(param: string, keys: readonly K[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get(param);
  const active = (keys as readonly string[]).includes(raw ?? "") ? (raw as K) : keys[0];

  const select = useCallback(
    (key: K) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(param, key);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [param, pathname, router, searchParams]
  );

  return [active, select] as const;
}

/** Accessible tab strip: tablist/tab roles, roving tabindex, Left/Right/Home/End keys. */
export function TabStrip<K extends string>({
  tabs,
  active,
  onSelect,
  label,
  idPrefix = "tab",
}: {
  tabs: readonly { key: K; label: string }[];
  active: K;
  onSelect: (key: K) => void;
  label: string;
  idPrefix?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onSelect(tabs[next].key);
    refs.current[tabs[next].key]?.focus();
  }

  return (
    <div className="border-b border-border">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[tab.key] = el;
            }}
            id={`${idPrefix}-${tab.key}`}
            role="tab"
            type="button"
            aria-selected={active === tab.key}
            aria-controls={`${idPrefix}-panel-${tab.key}`}
            tabIndex={active === tab.key ? 0 : -1}
            onClick={() => onSelect(tab.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "-mb-px min-h-11 rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              active === tab.key
                ? "border-burgundy bg-surface text-burgundy"
                : "border-transparent text-muted hover:text-ink"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
