import Link from "next/link";
import { cn } from "@/lib/cn";
import { ScrollRow } from "./scroll-row";

export interface SettingsNavItem {
  key: string;
  label: string;
  /** Link-only items open their own page instead of rendering in the workspace. */
  href?: string;
}

/** One plain-language area of settings ("People & access") holding the sections that belong together. */
export interface SettingsArea {
  key: string;
  label: string;
  /** One sentence in everyday words: what you can do here. */
  description: string;
  items: SettingsNavItem[];
}

function hrefFor(item: SettingsNavItem) {
  return item.href ?? `/inspect/settings?section=${item.key}`;
}

/**
 * The Settings front door: one card per area, each listing its sections. Nothing is nested more than one
 * level, so a person picks the job ("People & access"), then the section, and never sees a long rail.
 */
export function SettingsLanding({ areas }: { areas: SettingsArea[] }) {
  return (
    <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Settings areas">
      {areas.map((a) => (
        <li key={a.key} className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
          <h2 className="text-base font-semibold text-text-strong">{a.label}</h2>
          <p className="mt-1 text-sm text-muted">{a.description}</p>
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {a.items.map((item) => (
              <li key={item.key}>
                <Link
                  href={hrefFor(item)}
                  className="flex min-h-11 items-center justify-between gap-2 py-2 text-sm font-medium text-ink hover:text-burgundy"
                >
                  <span>{item.label}</span>
                  <span aria-hidden="true" className="text-muted">{item.href ? "↗" : "›"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * Inside a section: a way back to all settings, the area's name, and ONE row of tabs for the sections of
 * that area only (not the whole settings tree). Same on phone, tablet and desktop; scrolls sideways when it
 * has to, never wraps, and every target is 44px tall.
 */
export function SettingsAreaTabs({ area, active, showAllLink }: { area: SettingsArea; active: string; showAllLink: boolean }) {
  return (
    <nav aria-label="Settings" className="mt-4">
      <div className="flex flex-wrap items-center gap-x-2 text-sm">
        {showAllLink && (
          <>
            <Link href="/inspect/settings" className="inline-flex min-h-9 items-center font-medium text-brand hover:underline [@media(pointer:coarse)]:min-h-11">
              ← All settings
            </Link>
            <span aria-hidden="true" className="text-muted">/</span>
          </>
        )}
        <span className="font-semibold text-ink">{area.label}</span>
      </div>
      {area.items.length > 1 && (
        <ScrollRow className="mt-2 flex snap-x gap-1 overflow-x-auto border-b border-border [scrollbar-width:thin]" label={area.label}>
          {area.items.map((item) => {
            const isActive = item.key === active;
            return (
              <li key={item.key} className="snap-start">
                <Link
                  href={hrefFor(item)}
                  scroll={false}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                    isActive ? "border-burgundy text-burgundy" : "border-transparent text-muted hover:text-ink"
                  )}
                >
                  {item.label}
                  {item.href ? <span aria-hidden="true"> ↗</span> : null}
                </Link>
              </li>
            );
          })}
        </ScrollRow>
      )}
    </nav>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading section">
      <div className="h-8 w-56 animate-pulse rounded bg-off-white" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-off-white" />
      ))}
    </div>
  );
}
