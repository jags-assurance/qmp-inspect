"use client";

import { useState, useTransition } from "react";
import { saveChecklistResponseAction } from "@/lib/checklists/actions";
import type { ChecklistResponseResult } from "@/lib/checklists/db-types";
import type { RegisterVerificationResult } from "@/lib/registers/verify";
import { cn } from "@/lib/cn";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";

const PILLS: { value: ChecklistResponseResult; label: string; activeClass: string }[] = [
  { value: "yes", label: "Yes", activeClass: "bg-success text-white border-success" },
  { value: "no", label: "No", activeClass: "bg-danger text-white border-danger" },
  { value: "na", label: "N/A", activeClass: "bg-muted text-white border-muted" },
];

// Register overrides are stored inline in checklist_responses.comment (a minimal-schema-footprint
// choice, see registers/verify.ts and this task's spec) rather than a new column, using this fixed
// prefix so it can be told apart from the inspector's own free-text comment on redisplay.
const OVERRIDE_PREFIX = "[Register override] ";

/** Splits a stored comment back into { overrideReason, comment } using the OVERRIDE_PREFIX marker. */
function splitStoredComment(stored: string): { overrideReason: string; comment: string } {
  if (!stored.startsWith(OVERRIDE_PREFIX)) return { overrideReason: "", comment: stored };
  const rest = stored.slice(OVERRIDE_PREFIX.length);
  const newlineIndex = rest.indexOf("\n");
  if (newlineIndex === -1) return { overrideReason: rest, comment: "" };
  return { overrideReason: rest.slice(0, newlineIndex), comment: rest.slice(newlineIndex + 1) };
}

function combineStoredComment(overrideReason: string, comment: string): string {
  if (!overrideReason.trim()) return comment;
  return `${OVERRIDE_PREFIX}${overrideReason.trim()}${comment ? `\n${comment}` : ""}`;
}

/**
 * One checklist item in the field-execution view: large touch-target Yes/No/N-A pills (not a
 * <select> — this is meant to be usable one-handed on a tablet) plus a comment textarea, auto-
 * saved on every change via saveChecklistResponseAction (same "no separate save step" pattern as
 * the ITP intervention grid).
 */
export function ResponseRow({
  templateId,
  inspectionRecordId,
  checklistItemId,
  itemNumber,
  description,
  isMandatory,
  initialResult,
  initialComment,
  readOnly,
  registerVerification,
}: {
  templateId: string;
  inspectionRecordId: string;
  checklistItemId: string;
  itemNumber: string;
  description: string;
  isMandatory: boolean;
  initialResult: ChecklistResponseResult | null;
  initialComment: string;
  readOnly: boolean;
  /** R92-R100 register-fed auto-verification for this item's activity, or null if not applicable. */
  registerVerification: RegisterVerificationResult | null;
}) {
  const initialSplit = splitStoredComment(initialComment);
  const [result, setResult] = useState<ChecklistResponseResult | null>(initialResult);
  const [comment, setComment] = useState(initialSplit.comment);
  const [overrideReason, setOverrideReason] = useState(initialSplit.overrideReason);
  const [isSaving, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  // R99: a register mismatch/not-found is a soft-stop — it never blocks recording a response
  // outright, but does require the inspector to type a short reason before the Yes/No/N-A buttons
  // become usable for this item.
  const needsOverrideReason = registerVerification?.tone === "warning" && registerVerification.requiresOverrideReason;
  const overrideSatisfied = !needsOverrideReason || overrideReason.trim().length > 0;

  function save(nextResult: ChecklistResponseResult | null, nextComment: string, nextOverrideReason: string) {
    if (readOnly || !nextResult) return;
    if (needsOverrideReason && !nextOverrideReason.trim()) return;
    const formData = new FormData();
    formData.set("template_id", templateId);
    formData.set("inspection_record_id", inspectionRecordId);
    formData.set("checklist_item_id", checklistItemId);
    formData.set("result", nextResult);
    formData.set("comment", combineStoredComment(nextOverrideReason, nextComment));

    setSaveError(null);
    startTransition(async () => {
      // Offline (R60): rather than let the Server Action's own fetch fail, queue the response
      // right away when we already know there's no connection, and fall back to the queue if a
      // "we thought we were online" attempt fails too (a dropped connection mid-save).
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueOutboxItem({ kind: "checklist_response", fields: Object.fromEntries(formData) as Record<string, string> });
        notifyOutboxChanged();
        return;
      }
      try {
        const outcome = await saveChecklistResponseAction(formData);
        if (outcome.error) setSaveError(outcome.error);
      } catch {
        await enqueueOutboxItem({ kind: "checklist_response", fields: Object.fromEntries(formData) as Record<string, string> });
        notifyOutboxChanged();
      }
    });
  }

  return (
    <div className="border-b border-border p-4 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">
            <span className="doc-id text-muted">{itemNumber}.</span> {description}
            {isMandatory && <span className="ml-1 text-danger">*</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {registerVerification && (
          <p
            className={cn(
              "rounded-md px-3 py-2 text-xs",
              registerVerification.tone === "warning" ? "bg-warning/10 text-warning" : "bg-info/10 text-info"
            )}
          >
            {registerVerification.tone === "warning" ? "⚠ " : ""}
            {registerVerification.message}
          </p>
        )}

        {needsOverrideReason && (
          <input
            type="text"
            disabled={readOnly}
            defaultValue={overrideReason}
            placeholder="Reason to proceed despite the register warning above (required)"
            onBlur={(e) => {
              setOverrideReason(e.target.value);
              save(result, comment, e.target.value);
            }}
            className="w-full rounded-md border border-warning/40 bg-surface px-3 py-2 text-sm outline-none focus:border-warning disabled:opacity-60"
          />
        )}

        <div className="flex gap-2">
          {PILLS.map((pill) => (
            <button
              key={pill.value}
              type="button"
              disabled={readOnly || !overrideSatisfied}
              title={!overrideSatisfied ? "Enter a reason above before recording a response." : undefined}
              onClick={() => {
                setResult(pill.value);
                save(pill.value, comment, overrideReason);
              }}
              className={cn(
                "min-w-24 rounded-lg border-2 px-6 py-4 text-base font-bold transition-colors disabled:opacity-60",
                result === pill.value ? pill.activeClass : "border-border bg-surface text-ink hover:bg-off-white"
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {result === "no" && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            Marked as No — consider raising an NCR against this activity once the inspection is complete.
          </p>
        )}

        <textarea
          rows={2}
          disabled={readOnly}
          defaultValue={comment}
          placeholder="Comment (optional)"
          onBlur={(e) => {
            setComment(e.target.value);
            save(result, e.target.value, overrideReason);
          }}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy disabled:opacity-60"
        />
        {isSaving && <p className="text-xs text-muted">Saving…</p>}
        {!isSaving && saveError && <p className="text-xs text-danger">{saveError}</p>}
      </div>
    </div>
  );
}
