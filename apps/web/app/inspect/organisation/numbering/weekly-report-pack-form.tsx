"use client";

import { ProjectScopeSelect } from "@/components/domain/project-scope-select";
import { useActionState, useEffect } from "react";
import {
  requestWeeklyReportPackAction,
  listWeeklyReportPacks,
  type RequestWeeklyReportPackState,
  type WeeklyReportPackListItem,
} from "@/lib/reports/actions";
import { useReportPackListPolling } from "@/lib/reports/use-report-pack-polling";
import { REPORT_PACK_STATUS_LABEL } from "@/lib/reports/status-labels";
import { renderingLabel, jobStatusText } from "@/lib/reports/pdf-job-labels";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";

const initialState: RequestWeeklyReportPackState = { error: null };

/** Monday of the current week, as a YYYY-MM-DD string — a sensible default "week starting" date. */
function defaultWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  return monday.toISOString().slice(0, 10);
}

/** Same polling/View+Download fix as MonthlyReportPackForm — see its doc comment. */
export function WeeklyReportPackForm({ organizationId, initialPacks, projects = [] }: { organizationId: string; initialPacks: WeeklyReportPackListItem[]; projects?: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(requestWeeklyReportPackAction, initialState);
  const { items: weeklyReportPacks, polling, startPolling } = useReportPackListPolling(initialPacks, listWeeklyReportPacks, organizationId);
  const inFlightPack = weeklyReportPacks.find((p) => p.status === "pending" || p.status === "processing");

  useEffect(() => {
    if (state.success) startPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPolling is stable; only re-fire on a new success
  }, [state.success]);

  const packColumns: ResponsiveColumn<WeeklyReportPackListItem>[] = [
    { key: "period", header: "Week", className: "py-2", render: (pack) => `Week of ${pack.weekStart}` },
    { key: "status", header: "Status", render: (pack) => REPORT_PACK_STATUS_LABEL[pack.status] ?? pack.status },
    {
      key: "requested",
      header: "Requested",
      className: "text-xs text-muted",
      render: (pack) => new Date(pack.createdAt).toLocaleString("en-GB"),
    },
    {
      key: "download",
      header: "Download",
      render: (pack) =>
        pack.status === "completed" && pack.pdfUrl ? (
          <span className="flex flex-wrap gap-3">
            <a href={pack.pdfUrl} target="_blank" rel="noreferrer" className="text-burgundy underline">
              View PDF
            </a>
            {pack.pdfDownloadUrl && (
              <a href={pack.pdfDownloadUrl} className="text-burgundy underline">
                Download PDF
              </a>
            )}
            {pack.xlsxDownloadUrl && (
              <a href={pack.xlsxDownloadUrl} className="text-burgundy underline">
                Download Excel
              </a>
            )}
          </span>
        ) : pack.status === "failed" ? (
          <span className="text-xs text-danger">{pack.errorMessage ?? "Failed"}</span>
        ) : (
          <span className="text-xs text-muted">{jobStatusText({ status: pack.status as "pending" | "processing" | "completed" | "failed", errorMessage: pack.errorMessage })}</span>
        ),
    },
  ];

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="organization_id" value={organizationId} />
        <ProjectScopeSelect projects={projects} />

        <div>
          <FormField label="Week starting">
            <input
            name="week_start"
            type="date"
            defaultValue={defaultWeekStart()}
            className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>

        <Button type="submit" disabled={pending || polling}>
          {pending ? "Queuing…" : polling ? renderingLabel(inFlightPack) : "Generate weekly report pack"}
        </Button>

        {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
        {polling && <p className="w-full text-sm text-muted">{renderingLabel(inFlightPack)} — the table below updates automatically when ready…</p>}
      </form>

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Generated report packs</h3>
      {weeklyReportPacks.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No report packs generated yet for this organisation.</p>
      ) : (
        <div className="mt-2">
          <ResponsiveTable
            columns={packColumns}
            rows={weeklyReportPacks}
            rowKey={(pack) => pack.id}
            caption="Report packs"
            headRowClassName="border-b border-border text-left text-xs uppercase text-muted"
            thClassName="py-2"
            tdClassName="py-2"
          />
        </div>
      )}
    </div>
  );
}
