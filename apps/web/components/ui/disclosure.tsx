import type { DetailsHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type DisclosureVariant = "inline" | "card" | "pill";

/**
 * The ONE show/hide control (native <details>/<summary>: works with no JavaScript, keyboard and screen
 * reader friendly, server-component safe). Do not hand-style a <summary>; use this.
 *
 *  - `inline`: a text toggle that sits in running content ("Show advanced options"). Brand-coloured.
 *  - `pill`: a small bordered pill for secondary detail ("Details", "How is this calculated?").
 *  - `card`: a full-width bordered card whose header row is the toggle (a collapsible block of content).
 *
 * Built in: chevron that rotates when open (flips in RTL), control border, 44px touch target on touch
 * screens, the global focus ring, the native marker hidden. Collapsed by default (`defaultOpen`).
 * Extra props (id, name for exclusive groups, onToggle from a client component, ...) go to <details>.
 */
export function Disclosure({
  summary,
  children,
  variant = "inline",
  defaultOpen = false,
  actions,
  className,
  summaryClassName,
  bodyClassName,
  ...rest
}: {
  /** The always-visible label. Pass translated text (or <Tx>). */
  summary: ReactNode;
  children: ReactNode;
  variant?: DisclosureVariant;
  defaultOpen?: boolean;
  /** `card` only: controls shown at the end of the header row (kept inside the toggle area). */
  actions?: ReactNode;
  /** Classes for the <details> root (margins, width). */
  className?: string;
  /** Extra classes for the <summary>. */
  summaryClassName?: string;
  /** Classes for the body wrapper. REPLACES the variant default (inline/pill: `mt-2`; card: `border-t border-border p-4 sm:p-5`). */
  bodyClassName?: string;
} & Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "className" | "open" | "children">) {
  const touch = "[@media(pointer:coarse)]:min-h-11";
  const chevron = (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-open:rotate-[-90deg]",
        variant === "card" ? "h-4 w-4 text-muted" : "h-3.5 w-3.5"
      )}
    >
      <path d="M7 4.5l5.5 5.5-5.5 5.5" />
    </svg>
  );

  if (variant === "card") {
    return (
      <details open={defaultOpen} className={cn("group rounded-lg border border-border bg-surface shadow-xs", className)} {...rest}>
        <summary
          className={cn(
            "flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-ink hover:bg-surface-subtle group-open:rounded-b-none sm:px-5 [&::-webkit-details-marker]:hidden",
            summaryClassName
          )}
        >
          {chevron}
          <span className="min-w-0 flex-1">{summary}</span>
          {actions && <span className="ms-auto flex shrink-0 items-center gap-2">{actions}</span>}
        </summary>
        <div className={bodyClassName ?? "border-t border-border p-4 sm:p-5"}>{children}</div>
      </details>
    );
  }

  const isPill = variant === "pill";
  return (
    <details open={defaultOpen} className={cn("group", className)} {...rest}>
      <summary
        className={cn(
          "inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden",
          touch,
          isPill
            ? "min-h-8 rounded-full border border-control-border bg-surface px-3 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
            : "rounded-sm text-brand hover:text-brand-hover hover:underline",
          summaryClassName
        )}
      >
        {chevron}
        <span>{summary}</span>
      </summary>
      <div className={bodyClassName ?? "mt-2"}>{children}</div>
    </details>
  );
}
