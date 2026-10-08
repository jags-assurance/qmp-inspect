"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslate } from "@/lib/i18n/locale-context";

export function StatCard({
  label,
  value,
  icon,
  href,
  caption,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Optional destination — turns the card into a real link instead of a dead number, e.g. to the
   * list of items the count actually represents. Omit for a purely informational stat. */
  href?: string;
  /** Optional small line under the value — e.g. a sample-size note ("based on 4 data points") so a
   * viewer can judge how much confidence to put in a computed average/rate. Omit when not needed. */
  caption?: ReactNode;
}) {
  // Label + icon on top, value pinned to the bottom: tiles in one row stay the same height with
  // their numbers on one baseline even when one label wraps to two lines.
  const t = useTranslate();
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm leading-snug text-muted">{t(label)}</span>
        {icon && <span className="shrink-0">{icon}</span>}
      </div>
      <div className="mt-auto pt-2">
        <div className="text-2xl font-semibold leading-none text-ink">{value}</div>
        {caption && <div className="mt-1.5 text-xs text-muted">{caption}</div>}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="flex h-full min-h-[4.25rem] flex-col rounded-lg border border-border bg-surface px-3.5 py-3 transition-colors hover:border-burgundy hover:bg-off-white"
      >
        {content}
      </Link>
    );
  }

  return <div className="flex h-full min-h-[4.25rem] flex-col rounded-lg border border-border bg-surface px-3.5 py-3">{content}</div>;
}
