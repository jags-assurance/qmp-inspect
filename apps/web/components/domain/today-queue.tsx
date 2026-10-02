"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useUrlPanel } from "@/components/ui/side-panel";
import { cn } from "@/lib/cn";

export type TodayKind = "inspection" | "hold" | "signoff" | "ncr" | "acceptance" | "review" | "proposal" | "assignment";

export interface TodayItem {
  id: string;
  kind: TodayKind;
  title: string;
  meta?: string;
  /** Short right-hand label, e.g. "3d overdue" or "Due 12/10/2026". */
  badge?: string;
  /** 2 = overdue / blocking, 1 = due today / needs a response, 0 = routine. Drives grouping. */
  urgency: 0 | 1 | 2;
  /** Where the row goes when it has no side panel. */
  href?: string;
  /** If set, the row opens `?panel=<value>` (the dashboard's own side panel) instead of navigating. */
  panel?: string;
  actionLabel?: string;
}

const KIND_LABEL: Record<TodayKind, string> = {
  inspection: "Inspection",
  hold: "Hold point",
  signoff: "Sign-off",
  ncr: "NCR",
  acceptance: "ITP acceptance",
  review: "Review",
  proposal: "Proposal",
  assignment: "Assignment",
};

const KIND_TONE: Record<TodayKind, "neutral" | "danger" | "warning" | "info" | "gold" | "success"> = {
  inspection: "info",
  hold: "danger",
  signoff: "warning",
  ncr: "danger",
  acceptance: "gold",
  review: "warning",
  proposal: "gold",
  assignment: "info",
};

const GROUPS: { urgency: 0 | 1 | 2; label: string; hint: string }[] = [
  { urgency: 2, label: "Needs action now", hint: "Overdue or blocking other work" },
  { urgency: 1, label: "Today", hint: "Waiting on your response" },
  { urgency: 0, label: "Routine", hint: "On your list, nothing urgent" },
];

/**
 * One list of everything you have to do, across record types, ordered by urgency — so the day starts
 * from a single place instead of visiting the ITP, NCR, sign-off and checklist pages to find out.
 * Rows that have a dashboard side panel open it in place; the rest link straight to the record.
 * Filter chips narrow by type; counts always reflect the full list.
 */
export function TodayQueue({
  title = "Today",
  description,
  items,
  emptyText = "You're all caught up.",
}: {
  title?: string;
  description?: string;
  items: TodayItem[];
  emptyText?: string;
}) {
  const panel = useUrlPanel("panel");
  const [kind, setKind] = useState<TodayKind | "all">("all");
  // Long days stay scannable: each group shows its first few rows and expands on request.
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const kinds = [...new Set(items.map((i) => i.kind))];
  const visible = items.filter((i) => kind === "all" || i.kind === kind);

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-5" aria-labelledby="today-queue-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="today-queue-title" className="font-medium text-ink">
            {title}
            {items.length > 0 && <span className="ml-2 text-sm font-normal text-muted">{items.length} to do</span>}
          </h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {kinds.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
            {(["all", ...kinds] as const).map((k) => {
              const count = k === "all" ? items.length : items.filter((i) => i.kind === k).length;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-xs font-medium",
                    kind === k ? "border-burgundy bg-burgundy text-white" : "border-border bg-surface text-ink hover:bg-off-white"
                  )}
                >
                  {k === "all" ? "All" : KIND_LABEL[k]} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-md bg-off-white px-3 py-4 text-sm text-muted">{emptyText}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {GROUPS.map((group) => {
            const all = visible.filter((i) => i.urgency === group.urgency);
            if (all.length === 0) return null;
            const LIMIT = 6;
            const open = expanded[group.urgency] || all.length <= LIMIT + 1;
            const rows = open ? all : all.slice(0, LIMIT);
            return (
              <div key={group.urgency}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.label} <span className="font-normal normal-case">· {group.hint}</span>
                </h3>
                <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                  {rows.map((item) => {
                    const row = (
                      <>
                        <span className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
                          <Badge tone={KIND_TONE[item.kind]}>{KIND_LABEL[item.kind]}</Badge>
                          {item.badge && (
                            <span className={cn("text-xs font-semibold sm:hidden", item.urgency === 2 ? "text-danger" : "text-muted")}>
                              {item.badge}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1 basis-[12rem]">
                          <span className="block text-sm text-ink [overflow-wrap:anywhere] sm:truncate">{item.title}</span>
                          {item.meta && <span className="block text-xs text-muted [overflow-wrap:anywhere] sm:truncate">{item.meta}</span>}
                        </span>
                        {item.badge && (
                          <span className={cn("hidden shrink-0 text-xs font-semibold sm:inline", item.urgency === 2 ? "text-danger" : "text-muted")}>
                            {item.badge}
                          </span>
                        )}
                        <span className="shrink-0 text-sm font-medium text-burgundy">{item.actionLabel ?? "Open"} →</span>
                      </>
                    );
                    const cls = "flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-off-white";
                    return (
                      <li key={`${item.kind}-${item.id}`}>
                        {item.panel ? (
                          <button type="button" onClick={() => panel.open(item.panel!)} className={cls}>
                            {row}
                          </button>
                        ) : (
                          <Link href={item.href ?? "#"} className={cls}>
                            {row}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {all.length > LIMIT + 1 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [group.urgency]: !open }))}
                    className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-burgundy hover:underline"
                  >
                    {open ? "Show fewer" : `Show ${all.length - LIMIT} more`}
                  </button>
                )}
              </div>
            );
          })}
          {visible.length === 0 && <p className="text-sm text-muted">Nothing of this type.</p>}
        </div>
      )}
    </section>
  );
}
