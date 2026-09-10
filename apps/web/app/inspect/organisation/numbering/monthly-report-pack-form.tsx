"use client";

import { useActionState } from "react";
import { generateMonthlyReportPackAction, type GenerateMonthlyReportPackState } from "@/lib/reports/actions";
import { Button } from "@/components/ui/button";

const initialState: GenerateMonthlyReportPackState = { error: null };

const MONTH_OPTIONS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, i) => ({ label, value: i + 1 }));

export function MonthlyReportPackForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(generateMonthlyReportPackAction, initialState);
  const now = new Date();

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="organization_id" value={organizationId} />

      <div>
        <label className="block text-xs text-muted">Month</label>
        <select
          name="month"
          defaultValue={now.getMonth() + 1}
          className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-muted">Year</label>
        <input
          name="year"
          type="number"
          min={2020}
          max={2100}
          defaultValue={now.getFullYear()}
          className="mt-1 w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Queuing…" : "Generate monthly report pack"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
      {state.success && !state.error && (
        <p className="w-full text-sm text-muted">
          Queued. The pack (PDF + CSV{/* xlsx/exceljs is not in this monorepo, see generateMonthlyReportPack.ts */}) will
          appear in the list below once the worker finishes rendering it.
        </p>
      )}
    </form>
  );
}
