"use client";

import { useRef, useState, type FormEvent } from "react";
import { renameItpSectionAction, deleteItpSectionAction, moveSectionUpAction, moveSectionDownAction } from "@/lib/itps/sections";

/**
 * R24: inline rename + delete + move-up/move-down for a single section header, shown in place of
 * the plain "{section_number}. {title}" heading once canEditContent is true. Since a section edit
 * after issue is an R101 edit-after-issue too, every mutating form here prompts for a revision
 * reason first when isIssued — same "record why, then apply" gate as AddItemForm/AddSectionForm,
 * just collected via prompt() since there's no persistent form field to host it inline in a
 * heading row (prompt()/confirm() are already this app's lightweight style for this — see
 * issue-clearance-form.tsx and finalize-form.tsx).
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
  const [value, setValue] = useState(title);
  const renameFormRef = useRef<HTMLFormElement>(null);
  const renameReasonRef = useRef<HTMLInputElement>(null);
  const deleteReasonRef = useRef<HTMLInputElement>(null);
  const upReasonRef = useRef<HTMLInputElement>(null);
  const downReasonRef = useRef<HTMLInputElement>(null);

  function askRevisionReason(): string | null {
    const reason = prompt("This ITP has already been issued — reason for this change (will start a new revision):");
    return reason && reason.trim() ? reason.trim() : null;
  }

  function handleRenameBlur() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === title) {
      setValue(title);
      return;
    }
    if (isIssued) {
      const reason = askRevisionReason();
      if (!reason) {
        setValue(title);
        return;
      }
      renameReasonRef.current!.value = reason;
    }
    renameFormRef.current?.requestSubmit();
  }

  function handleDeleteSubmit(e: FormEvent<HTMLFormElement>) {
    if (!confirm(`Delete section "${sectionNumber}. ${title}"? This also deletes every activity in it. This cannot be undone.`)) {
      e.preventDefault();
      return;
    }
    if (isIssued) {
      const reason = askRevisionReason();
      if (!reason) {
        e.preventDefault();
        return;
      }
      deleteReasonRef.current!.value = reason;
    }
  }

  function handleMoveUpSubmit(e: FormEvent<HTMLFormElement>) {
    if (isIssued) {
      const reason = askRevisionReason();
      if (!reason) {
        e.preventDefault();
        return;
      }
      upReasonRef.current!.value = reason;
    }
  }

  function handleMoveDownSubmit(e: FormEvent<HTMLFormElement>) {
    if (isIssued) {
      const reason = askRevisionReason();
      if (!reason) {
        e.preventDefault();
        return;
      }
      downReasonRef.current!.value = reason;
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-muted">{sectionNumber}.</span>
      <form ref={renameFormRef} action={renameItpSectionAction} className="min-w-0 flex-1">
        <input type="hidden" name="itp_id" value={itpId} />
        <input type="hidden" name="section_id" value={sectionId} />
        <input type="hidden" name="revision_reason" ref={renameReasonRef} />
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
          <form action={moveSectionUpAction} onSubmit={handleMoveUpSubmit}>
            <input type="hidden" name="itp_id" value={itpId} />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="revision_reason" ref={upReasonRef} />
            <button type="submit" title="Move section up" className="rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-off-white">
              ↑
            </button>
          </form>
        )}
        {!isLast && (
          <form action={moveSectionDownAction} onSubmit={handleMoveDownSubmit}>
            <input type="hidden" name="itp_id" value={itpId} />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="revision_reason" ref={downReasonRef} />
            <button type="submit" title="Move section down" className="rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-off-white">
              ↓
            </button>
          </form>
        )}
        {!isOnlySection && (
          <form action={deleteItpSectionAction} onSubmit={handleDeleteSubmit}>
            <input type="hidden" name="itp_id" value={itpId} />
            <input type="hidden" name="section_id" value={sectionId} />
            <input type="hidden" name="revision_reason" ref={deleteReasonRef} />
            <button type="submit" title="Delete section" className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-danger hover:bg-danger/10">
              Delete
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
