"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { FirstAttemptRecordRow } from "@/lib/kpis/compute";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { Tx } from "@/components/domain/tx";

const RESULT_LABEL: Record<NonNullable<FirstAttemptRecordRow["result"]>, string> = {
  pass: "Passed",
  fail: "Failed",
  partial: "Partial",
};

const RESULT_TONE: Record<NonNullable<FirstAttemptRecordRow["result"]>, "success" | "danger" | "warning"> = {
  pass: "success",
  fail: "danger",
  partial: "warning",
};

/**
 * Wraps the "First-time pass rate" stat card so it's clickable, and — when open — expands to the
 * real first-attempt records that number is computed from (plan Phase 9), right below the KPI
 * strip. No separate page or duplicated computation: same firstAttemptRecords list
 * computeProjectKpis already derives the rate from.
 */
const recordColumns: ResponsiveColumn<FirstAttemptRecordRow>[] = [
  { key: "activity", header: "Activity", className: "text-ink", render: (r) => r.activity },
  { key: "itp", header: "ITP", className: "text-xs text-muted", render: (r) => r.itpNumber ?? "—" },
  { key: "date", header: "Date", className: "text-xs text-muted", render: (r) => new Date(r.recordedAt).toLocaleDateString("en-GB") },
  {
    key: "result",
    header: "Result",
    render: (r) => (r.result ? <Badge tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Badge> : "—"),
  },
];

export function KpiDrilldown({
  trigger,
  records,
}: {
  trigger: React.ReactNode;
  records: FirstAttemptRecordRow[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full rounded-lg text-start ring-offset-2 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy"
      >
        {trigger}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink"><Tx>First-time pass rate — contributing inspections</Tx></h3>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
              <Tx>Close</Tx>
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">
            <Tx>Every activity&rsquo;s earliest recorded inspection, pass or fail — this is what the rate above is computed from.</Tx>
          </p>
          <div className="mt-3 max-h-80 overflow-auto">
            <ResponsiveTable
              columns={recordColumns}
              rows={records}
              rowKey={(r) => r.id}
              caption="First-attempt inspections"
              wrapperClassName=""
              thClassName="px-2 py-1.5 font-medium"
              tdClassName="px-2 py-1.5"
              emptyCellClassName="px-2 py-4 text-center text-muted"
              empty="No first-attempt inspections recorded yet."
            />
          </div>
        </div>
      )}
    </div>
  );
}
