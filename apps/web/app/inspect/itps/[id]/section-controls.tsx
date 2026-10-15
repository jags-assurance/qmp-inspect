"use client";

import { useState, useTransition, type FocusEvent, type FormEvent } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { renameItpSectionAction, deleteItpSectionAction, moveSectionUpAction, moveSectionDownAction } from "@/lib/itps/sections";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

/**
 * R24: inline rename + delete + move-up/move-down for a single section header, shown in place of
 * the plain "{section_number}. {title}" heading once canEditContent is true. Since a section edit
 * after issue is an R101 edit-after-issue too, every mutating form here prompts for a revision
 * reason first when isIssued — same "record why, then apply" gate as AddItemForm/AddSectionForm,
 * just collected via the shared accessible ConfirmDialog since there's no persistent form field to
 * host it inline in a heading row.
 */
export function SectionControls({
  itpId,
  sectionId,
  sectionNumber,
  title,
  isIssued,
  isFirst,
  isLast,
  isOnlySection,
}: {
  itpId: string;
  sectionId: string;
  sectionNumber: number;
  title: string;
  isIssued: boolean;
  isFirst: boolean;
  isLast: boolean;
  isOnlySection: boolean;
}) {
  const tl = useTranslate();
  const [value, setValue] = useState(title);
  const { ask, dialog } = useConfirm();

  // The section actions return { error } (they used to return nothing, so a refused change was invisible).
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Applies the action; on an issued ITP first asks (in an accessible dialog) why, and starts a new
  // revision with that reason. `confirm` adds the destructive-action warning to the same dialog.
  async function gate(
    form: HTMLFormElement,
    action: (formData: FormData) => Promise<{ error: string | null }>,
    opts: { confirm?: string } = {}
  ): Promise<boolean> {
    const formData = new FormData(form);
    if (isIssued) {
      const reason = await ask({
        title: opts.confirm ? "Delete section?" : "Change an issued ITP",
        message: opts.confirm ?? "This ITP has already been issued. The change will start a new revision.",
        confirmLabel: opts.confirm ? "Delete" : "Apply change",
        destructive: !!opts.confirm,
        reason: { label: "Reason for this change", required: true },
      });
      if (!reason) return false;
      formData.set("revision_reason", reason);
    } else if (opts.confirm) {
      const ok = await ask({ title: "Delete section?", message: opts.confirm, confirmLabel: "Delete", destructive: true });
      if (ok === null) return false;
    }
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (result.error) {
        setError(result.error);
        setValue(title);
      }
    });
    return true;
  }

  async function handleRenameBlur(e: FocusEvent<HTMLInputElement>) {
    const form = e.currentTarget.form;
    const trimmed = value.trim();
    if (!form) return;
    if (!trimmed || trimmed === title) {
      setValue(title);
      return;
    }
    if (!(await gate(form, renameItpSectionAction))) setValue(title);
  }

  function submitWith(action: (formData: FormData) => Promise<{ error: string | null }>, confirmText?: string) {
    return (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void gate(e.currentTarget, action, { confirm: confirmText });
    };
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {dialog}
      <span className="text-sm font-medium text-muted">{sectionNumber}.</span>
      <form onSubmit={submitWith(renameItpSectionAction)} className="min-w-0 flex-1">
        <input type="hidden" name="itp_id" value={itpId} />
        <input type="hidden" name="section_id" value={sectionId} />
        <input
          name="title"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleRenameBlur}
          className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-medium text-ink outline-none hover:border-border focus:border-burgundy focus:bg-surface"
        />
      </form>

      <div className="flex items-center gap-1">
        {!isFirst && (
          <form onSubmit={submitWith(moveSectionUpAction)}>
            <input type="hidden" name="itp_id" value={itpId} />
            <input type="hidden" name="section_id" value={sectionId} />
            <Button type="submit" title={tl("Move section up")} variant="outline" size="sm">
              ↑
            </Button>
          </form>
        )}
        {!isLast && (
          <form onSubmit={submitWith(moveSectionDownAction)}>
            <input type="hidden" name="itp_id" value={itpId} />
            <input type="hidden" name="section_id" value={sectionId} />
            <Button type="submit" title={tl("Move section down")} variant="outline" size="sm">
              ↓
            </Button>
          </form>
        )}
        {!isOnlySection && (
          <form onSubmit={submitWith(deleteItpSectionAction, `Delete section "${sectionNumber}. ${title}"? This also deletes every activity in it. This cannot be undone.`)}>
            <input type="hidden" name="itp_id" value={itpId} />
            <input type="hidden" name="section_id" value={sectionId} />
            <Button type="submit" title={tl("Delete section")} variant="danger-outline" size="sm">
              <Tx>Delete</Tx>
            </Button>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
