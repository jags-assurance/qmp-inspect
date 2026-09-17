import type { ReactNode } from "react";
import Link from "next/link";

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
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {caption && <div className="mt-1 text-xs text-muted">{caption}</div>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:border-burgundy hover:bg-off-white"
      >
        {content}
      </Link>
    );
  }

  return <div className="rounded-lg border border-border bg-surface p-4">{content}</div>;
}
