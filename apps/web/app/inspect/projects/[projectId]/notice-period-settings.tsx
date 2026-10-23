"use client";

import { useActionState } from "react";
import {
  setProjectNoticePeriodAction,
  clearProjectNoticePeriodAction,
  type NoticePeriodConfigState,
} from "@/lib/signoff/notice-period-config-actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: NoticePeriodConfigState = { error: null };

/**
 * One row per this org's configured intervention level — sets/clears THIS project's own override
 * in notice_period_configs, the middle tier of getNoticePeriodHours' resolution chain
 * (lib/signoff/actions.ts): per-activity override > this project override > org default >
 * hardcoded fallback. Until this component existed, that middle tier had a table and a read path
 * but no way to ever write to it.
 */
export function NoticePeriodSettings({
  projectId,
  levels,
  configuredHours,
}: {
  projectId: string;
  levels: { code: string; label: string; default_notice_hours: number | null }[];
  /** This project's existing overrides, keyed by intervention code. */
  configuredHours: Record<string, number>;
}) {
  if (levels.length === 0) {
    return <p className="mt-3 text-sm text-muted"><Tx>No intervention levels configured for this organisation yet.</Tx></p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {levels.map((level) => (
        <NoticePeriodRow
          key={level.code}
          projectId={projectId}
          level={level}
          currentHours={configuredHours[level.code] ?? null}
        />
      ))}
    </div>
  );
}

function NoticePeriodRow({
  projectId,
  level,
  currentHours,
}: {
  projectId: string;
  level: { code: string; label: string; default_notice_hours: number | null };
  currentHours: number | null;
}) {
  const [setState, setFormAction, setPending] = useActionState(setProjectNoticePeriodAction, initialState);
  const [clearState, clearFormAction, clearPending] = useActionState(clearProjectNoticePeriodAction, initialState);
  const keepValuesSubmit_clearFormAction = useKeepFormValues(clearState, clearFormAction);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-off-white px-3 py-2">
      <span className="min-w-32 text-sm font-medium text-ink">
        {level.label} <span className="text-xs text-muted">({level.code})</span>
      </span>
      <form action={setFormAction} className="flex items-center gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="intervention" value={level.code} />
        <input aria-label={
            level.default_notice_hours != null ? `Org default: ${level.default_notice_hours}h` : "No default set"
          }
          name="hours"
          type="number"
          min={0}
          defaultValue={currentHours ?? ""}
          placeholder={
            level.default_notice_hours != null ? `Org default: ${level.default_notice_hours}h` : "No default set"
          }
          className="w-40 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        <Button
          type="submit"
          disabled={setPending}
          variant="outline" size="sm"
        >
          {setPending ? "Saving…" : "Save"}
        </Button>
      </form>
      {currentHours != null && (
        <form onSubmit={keepValuesSubmit_clearFormAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="intervention" value={level.code} />
          <Button
            type="submit"
            disabled={clearPending}
            variant="link-muted" size="sm"
          >
            {clearPending ? "Clearing…" : "Clear override"}
          </Button>
        </form>
      )}
      {currentHours == null && <span className="text-xs text-muted"><Tx>Using organisation default</Tx></span>}
      {setState.error && <p role="alert" className="w-full text-xs text-danger">{setState.error}</p>}
      {clearState.error && <p role="alert" className="w-full text-xs text-danger">{clearState.error}</p>}
    </div>
  );
}
