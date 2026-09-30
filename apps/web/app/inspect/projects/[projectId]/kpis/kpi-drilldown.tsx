"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { FirstAttemptRecordRow } from "@/lib/kpis/compute";

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
        className="w-full rounded-lg text-left ring-offset-2 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy"
      >
        {trigger}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink">First-time pass rate — contributing inspections</h3>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
              Close
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">
            Every activity&rsquo;s earliest recorded inspection, pass or fail — this is what the rate above is computed from.
          </p>
          <div className="mt-3 max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-2 py-1.5 font-medium">Activity</th>
                  <th className="px-2 py-1.5 font-medium">ITP</th>
                  <th className="px-2 py-1.5 font-medium">Date</th>
                  <th className="px-2 py-1.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5 text-ink">{r.activity}</td>
                    <td className="px-2 py-1.5 text-xs text-muted">{r.itpNumber ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs text-muted">{new Date(r.recordedAt).toLocaleDateString("en-GB")}</td>
                    <td className="px-2 py-1.5">
                      {r.result ? <Badge tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Badge> : "—"}
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-muted">
                      No first-attempt inspections recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
