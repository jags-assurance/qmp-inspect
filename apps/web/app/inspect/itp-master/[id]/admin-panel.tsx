"use client";

import { useActionState, useState } from "react";
import { updateMasterTemplateMetaAction, setMasterTemplateActiveAction, type MasterAdminState } from "@/lib/itp-master/admin-actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

const initial: MasterAdminState = { error: null };
const field = "mt-1 w-full min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy";

export function MasterAdminPanel({
  templateId,
  title,
  industry,
  standard,
  disciplineId,
  isActive,
  disciplines,
}: {
  templateId: string;
  title: string;
  industry: string;
  standard: string | null;
  disciplineId: string | null;
  isActive: boolean;
  disciplines: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [metaState, metaAction, metaPending] = useActionState(updateMasterTemplateMetaAction, initial);
  const [activeState, activeAction, activePending] = useActionState(setMasterTemplateActiveAction, initial);
  const { gateSubmit, dialog } = useConfirm();

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} className="min-h-11">
          {open ? "Close editor" : "Edit details"}
        </Button>
        <span className="text-xs text-muted">Admin only. Editing details does not change activities or the version number.</span>
      </div>

      {open && (
        <form action={metaAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="template_id" value={templateId} />
          <label className="text-sm text-ink sm:col-span-2">
            Title
            <input name="title" required maxLength={200} defaultValue={title} className={field} />
          </label>
          <label className="text-sm text-ink">
            Industry
            <input name="industry" required defaultValue={industry} className={field} />
          </label>
          <label className="text-sm text-ink">
            Discipline
            <select name="discipline_id" defaultValue={disciplineId ?? ""} className={field}>
              <option value="">None</option>
              {disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-ink sm:col-span-2">
            Applicable standard
            <input name="applicable_standard" defaultValue={standard ?? ""} className={field} />
          </label>
          {metaState.error && <p className="text-sm text-danger sm:col-span-2">{metaState.error}</p>}
          {metaState.ok && <p className="text-sm text-success sm:col-span-2">Saved.</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={metaPending}>
              {metaPending ? "Saving…" : "Save details"}
            </Button>
          </div>
        </form>
      )}

      <form
        action={activeAction}
        className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3"
        onSubmit={gateSubmit({
          title: isActive ? "Retire this template?" : "Reactivate this template?",
          message: isActive
            ? "It will no longer be offered for new ITPs."
            : "It will be available again for new ITPs.",
          confirmLabel: isActive ? "Retire template" : "Reactivate template",
          destructive: isActive,
        })}
      >
        {dialog}
        <input type="hidden" name="template_id" value={templateId} />
        <input type="hidden" name="active" value={isActive ? "false" : "true"} />
        {isActive && (
          <label className="min-w-0 flex-1 text-sm text-ink">
            Reason for retiring
            <input name="reason" required className={field} placeholder="e.g. superseded by v2 of the standard" />
          </label>
        )}
        <Button type="submit" variant="outline" disabled={activePending} className="min-h-11">
          {activePending ? "Saving…" : isActive ? "Retire template" : "Reactivate template"}
        </Button>
        {activeState.error && <p className="w-full text-sm text-danger">{activeState.error}</p>}
      </form>
    </div>
  );
}
