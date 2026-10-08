"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";

export type PendingActionPriority = "high" | "medium" | "low";

export interface PendingActionItem {
  templateId: string;
  checklistNumber: string;
  activity: string;
  /** Master discipline code (e.g. "ELE", "CIV"), or null if the activity isn't tagged. */
  discipline: string | null;
  /** Derived from the activity's real intervention levels (a Hold makes it high, a Witness medium) — not a stored/invented field, see page.tsx. */
  priority: PendingActionPriority;
  projectName: string;
  status: "not_started" | "in_progress";
}

const PRIORITY_LABEL: Record<PendingActionPriority, string> = { high: "High", medium: "Medium", low: "Low" };
const PRIORITY_TONE: Record<PendingActionPriority, "danger" | "warning" | "neutral"> = {
  high: "danger",
  medium: "warning",
  low: "neutral",
};

const columns: ResponsiveColumn<PendingActionItem>[] = [
  {
    key: "priority",
    header: "Priority",
    render: (action) => <Badge tone={PRIORITY_TONE[action.priority]}>{PRIORITY_LABEL[action.priority]}</Badge>,
  },
  {
    key: "activity",
    header: "Activity",
    tdClassName: "text-ink",
    render: (action) => (
      <>
        {action.activity}
        <div className="doc-id text-xs text-muted">{action.checklistNumber}</div>
      </>
    ),
  },
  {
    key: "project",
    header: "Project / Discipline",
    tdClassName: "text-muted",
    render: (action) => (
      <>
        {action.projectName}
        {action.discipline && <span className="text-xs"> · {action.discipline}</span>}
      </>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (action) => (
      <span
        className={
          action.status === "in_progress"
            ? "rounded bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning"
            : "rounded bg-muted/15 px-1.5 py-0.5 text-xs font-medium text-muted"
        }
      >
        {action.status === "in_progress" ? "In progress" : "Not started"}
      </span>
    ),
  },
  {
    key: "action",
    header: "Action",
    srOnlyHeader: true,
    cardLabel: null,
    tdClassName: "text-end",
    render: (action) => (
      <Link href={`/inspect/checklists/${action.templateId}`} className="inline-flex min-h-11 items-center text-burgundy hover:underline sm:min-h-0">
        {action.status === "in_progress" ? "Continue →" : "Start →"}
      </Link>
    ),
  },
];

/**
 * Tab-filtered view over the same "My pending actions" worklist — All / Today / Overdue. The
 * filtering itself happens server-side (page.tsx computes each bucket from real created_at
 * timestamps); this component just switches which precomputed list is on screen, no client fetch.
 */
export function PendingActionsTable({
  all,
  today,
  overdue,
}: {
  all: PendingActionItem[];
  today: PendingActionItem[];
  overdue: PendingActionItem[];
}) {
  const [tab, setTab] = useState<"all" | "today" | "overdue">("all");
  const rows = tab === "all" ? all : tab === "today" ? today : overdue;

  const tabs: { key: typeof tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: all.length },
    { key: "today", label: "Today", count: today.length },
    { key: "overdue", label: "Overdue", count: overdue.length },
  ];

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
              (tab === t.key
                ? "border-gold text-ink"
                : "border-transparent text-muted hover:text-ink")
            }
          >
            {t.label}
            <span className="text-xs text-muted">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <ResponsiveTable
          columns={columns}
          rows={rows}
          rowKey={(action) => action.templateId}
          caption="Pending actions"
          wrapperClassName="overflow-x-auto"
          thClassName="py-2 pe-3 font-medium"
          tdClassName="py-2 pe-3"
          cardClassName="px-1"
          emptyCellClassName="py-4 text-center text-sm text-muted"
          empty={
            tab === "all"
              ? "Nothing pending — every generated checklist has been completed."
              : tab === "today"
                ? "Nothing generated today."
                : "Nothing overdue right now."
          }
        />
      </div>
    </div>
  );
}
