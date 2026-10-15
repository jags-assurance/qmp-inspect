"use client";

import { Children } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { useTranslate } from "@/lib/i18n/locale-context";

export type StatTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "gold";

const CHIP: Record<StatTone, string> = {
  neutral: "bg-surface-sunken text-muted",
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  gold: "bg-gold/20 text-burgundy-dark",
};

/**
 * One KPI tile: label, big number, optional caption, optional icon. With `href` the whole tile is a
 * link (use it when the number is a count of a list that exists). `tone` colours the icon chip only;
 * the label is always text, so status never relies on colour alone. Same height across a row (the
 * value is pinned to the bottom). Use inside <StatGrid>.
 */
export function StatTile({
  label,
  value,
  icon,
  tone,
  href,
  caption,
  className,
}: {
  label: string;
  value: ReactNode;
  /** An svg (h-4/h-5) or any node; when `tone` is set it is wrapped in a 32px tinted chip. */
  icon?: ReactNode;
  tone?: StatTone;
  href?: string;
  caption?: ReactNode;
  className?: string;
}) {
  const t = useTranslate();
  const chip = icon ? (
    tone ? <span aria-hidden="true" className={cn("flex h-8 w-8 items-center justify-center rounded-full", CHIP[tone])}>{icon}</span> : <span className="shrink-0">{icon}</span>
  ) : null;
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug text-muted">{t(label)}</span>
        {chip && <span className="shrink-0">{chip}</span>}
      </div>
      <div className="mt-auto pt-3">
        <div className="text-2xl font-semibold leading-none tracking-tight text-text-strong tabular-nums">{value}</div>
        {caption && <div className="mt-1.5 text-xs text-muted">{caption}</div>}
      </div>
    </>
  );
  const base = "flex h-full min-h-24 flex-col rounded-lg border border-border bg-surface p-4 shadow-xs";
  if (href) {
    return (
      <Link href={href} className={cn(base, "transition-shadow hover:border-border-strong hover:shadow-md", className)}>
        {content}
      </Link>
    );
  }
  return <div className={cn(base, className)}>{content}</div>;
}

/**
 * Responsive KPI grid. `max` is the column count at the widest breakpoint: 2 columns on phones,
 * 3 from md (when max >= 3), 4 from xl, 6 from desk (1440). Tiles stretch to equal height.
 */
export function StatGrid({ children, max = 4, className }: { children: ReactNode; max?: 2 | 3 | 4 | 6; className?: string }) {
  const cols = {
    2: "grid-cols-2",
    3: "grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
    6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-4 desk:grid-cols-6",
  }[max];
  // Children.toArray gives every child a stable key, so tiles passed as Suspense/async server nodes do not trigger React key warnings.
  return <div className={cn("grid gap-3 sm:gap-4", cols, className)}>{Children.toArray(children)}</div>;
}
