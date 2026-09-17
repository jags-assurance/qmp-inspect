"use client";

import { useActionState } from "react";
import { requestWeeklyReportPackAction, type RequestWeeklyReportPackState } from "@/lib/reports/actions";
import { Button } from "@/components/ui/button";

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

export function WeeklyReportPackForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(requestWeeklyReportPackAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organization_id" value={organizationId} />

      <div>
        <label className="block text-xs text-muted">Week starting</label>
        <input
          name="week_start"
          type="date"
          defaultValue={defaultWeekStart()}
          className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Queuing…" : "Generate weekly report pack"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
      {state.success && !state.error && (
        <p className="w-full text-sm text-muted">
          Queued. The pack (PDF + CSV{/* xlsx/exceljs is not in this monorepo, see generateWeeklyReportPack.ts */}) will
          appear in the list below once the worker finishes rendering it.
        </p>
      )}
    </form>
  );
}
