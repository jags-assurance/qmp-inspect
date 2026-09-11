"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

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
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Priority</th>
              <th className="py-2 pr-3 font-medium">Activity</th>
              <th className="py-2 pr-3 font-medium">Project / Discipline</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((action) => (
              <tr key={action.templateId} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <Badge tone={PRIORITY_TONE[action.priority]}>{PRIORITY_LABEL[action.priority]}</Badge>
                </td>
                <td className="py-2 pr-3 text-ink">
                  {action.activity}
                  <div className="doc-id text-xs text-muted">{action.checklistNumber}</div>
                </td>
                <td className="py-2 pr-3 text-muted">
                  {action.projectName}
                  {action.discipline && <span className="text-xs"> · {action.discipline}</span>}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      action.status === "in_progress"
                        ? "rounded bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning"
                        : "rounded bg-muted/15 px-1.5 py-0.5 text-xs font-medium text-muted"
                    }
                  >
                    {action.status === "in_progress" ? "In progress" : "Not started"}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right">
                  <Link href={`/inspect/checklists/${action.templateId}`} className="text-burgundy hover:underline">
                    {action.status === "in_progress" ? "Continue →" : "Start →"}
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-sm text-muted">
                  {tab === "all"
                    ? "Nothing pending — every generated checklist has been completed."
                    : tab === "today"
                      ? "Nothing generated today."
                      : "Nothing overdue right now."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
