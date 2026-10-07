"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  archiveChecklistTemplateAction,
  deleteChecklistTemplateAction,
  duplicateChecklistTemplateAction,
  unarchiveChecklistTemplateAction,
} from "@/lib/checklists/template-actions";

/** Archive / restore / duplicate / delete controls for a checklist template (staff-facing). */
export function TemplateLifecycleControls({
  templateId,
  archived,
  deleteBlockedReason,
  duplicateTargets,
  backHref,
}: {
  templateId: string;
  archived: boolean;
  /** Set when the template has inspection records (delete is then disabled, archive is the way). */
  deleteBlockedReason: string | null;
  duplicateTargets: { itpItemId: string; label: string }[];
  backHref: string;
}) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const deleteReasonId = useId();
  const targetId = useId();

  function run(fn: () => Promise<{ error: string | null; templateId?: string }>, after?: (r: { templateId?: string }) => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else if (after) after(res);
      else router.refresh();
    });
  }

  async function archive() {
    const ok = await ask({
      title: "Archive this checklist?",
      message: "It will be hidden from start-inspection and list views. Existing inspection records keep it, and you can restore it later.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (ok !== null) run(() => archiveChecklistTemplateAction({ templateId }));
  }

  async function remove() {
    const ok = await ask({
      title: "Delete this checklist?",
      message: "The checklist and all its items are permanently deleted. This cannot be undone.",
      confirmLabel: "Delete checklist",
      destructive: true,
    });
    if (ok !== null) run(() => deleteChecklistTemplateAction({ templateId }), () => router.push(backHref));
  }

  return (
    <div className="space-y-3 border-t border-border bg-off-white px-4 py-4">
      {dialog}
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Checklist lifecycle</h3>
      <div className="flex flex-wrap items-center gap-2">
        {archived ? (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(() => unarchiveChecklistTemplateAction({ templateId }))}>
            Restore (unarchive)
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void archive()}>
            Archive
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-danger"
          disabled={pending || deleteBlockedReason !== null}
          aria-describedby={deleteBlockedReason ? deleteReasonId : undefined}
          onClick={() => void remove()}
        >
          Delete checklist
        </Button>
      </div>
      {deleteBlockedReason && (
        <p id={deleteReasonId} className="text-xs text-muted">
          Delete is disabled: {deleteBlockedReason}
        </p>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!target) return;
          run(
            () => duplicateChecklistTemplateAction({ templateId, targetItpItemId: target }),
            (r) => router.push(r.templateId ? `/inspect/checklists/${r.templateId}` : backHref)
          );
        }}
      >
        <div className="min-w-64 flex-1">
          <label htmlFor={targetId} className="block text-xs font-medium text-muted">
            Duplicate to activity
          </label>
          <select
            id={targetId}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={duplicateTargets.length === 0 || pending}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value="">{duplicateTargets.length === 0 ? "No eligible activity without a checklist" : "Choose an activity…"}</option>
            {duplicateTargets.map((t) => (
              <option key={t.itpItemId} value={t.itpItemId}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={!target || pending}>
          {pending ? "Working…" : "Duplicate"}
        </Button>
      </form>
      <div role="alert">{error && <p className="text-sm text-danger">{error}</p>}</div>
    </div>
  );
}
