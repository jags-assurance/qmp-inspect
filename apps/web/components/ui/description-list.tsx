import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface DescriptionItem {
  label: ReactNode;
  value: ReactNode;
  /** Span the full row (long text, notes). */
  wide?: boolean;
  /** Skip the item entirely (an optional field with no value). */
  hidden?: boolean;
}

/**
 * Label / value facts for detail pages and side panels. One column on phones, `columns` (default 2)
 * from md, always label-over-value so long values wrap instead of squeezing. Empty values render an
 * em dash. Server-component safe.
 */
export function DescriptionList({
  items,
  columns = 2,
  className,
}: {
  items: DescriptionItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const cols = columns === 1 ? "" : columns === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3";
  return (
    <dl className={cn("grid grid-cols-1 gap-x-8 gap-y-4", cols, className)}>
      {items
        .filter((i) => !i.hidden)
        .map((item, idx) => (
          <div key={idx} className={cn("min-w-0", item.wide && "md:col-span-full")}>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
            <dd className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">
              {item.value === null || item.value === undefined || item.value === "" ? <span className="text-muted">—</span> : item.value}
            </dd>
          </div>
        ))}
    </dl>
  );
}
