"use client";

import { useActionState } from "react";
import { finalizeAssignmentAction, type FinalizeAssignmentState } from "@/lib/standalone/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";

const initialState: FinalizeAssignmentState = { error: null };

const CONCLUSION_OPTIONS: {
  value: "pass" | "conditional_pass" | "fail";
  label: string;
  toneClasses: string;
}[] = [
  {
    value: "pass",
    label: "Pass",
    toneClasses: "has-[:checked]:border-success has-[:checked]:bg-success/10 has-[:checked]:text-success",
  },
  {
    value: "conditional_pass",
    label: "Conditional Pass",
    toneClasses: "has-[:checked]:border-gold has-[:checked]:bg-gold/20 has-[:checked]:text-[color:var(--color-burgundy-dark)]",
  },
  {
    value: "fail",
    label: "Fail",
    toneClasses: "has-[:checked]:border-danger has-[:checked]:bg-danger/10 has-[:checked]:text-danger",
  },
];

export function FinalizeForm({ assignmentId, hasSignature }: { assignmentId: string; hasSignature: boolean }) {
  const [state, formAction, pending] = useActionState(finalizeAssignmentAction, initialState);

  const { gateSubmit, dialog } = useConfirm();
  const handleSubmit = gateSubmit({
    title: "Finalize this assignment?",
    message: "Finalizing records the conclusion and locks this assignment from further edits.",
    confirmLabel: "Finalize",
  });

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
    >
      {dialog}
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <div>
        <span className="block text-xs text-muted">Conclusion</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {CONCLUSION_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "cursor-pointer rounded-full border border-border bg-off-white px-4 py-1.5 text-sm font-medium text-muted transition-colors",
                option.toneClasses
              )}
            >
              <input type="radio" name="conclusion" value={option.value} required className="sr-only" />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      {!hasSignature && (
        <p className="text-xs text-muted">
          Capture at least one signature under Witness Signatures before this can be finalized.
        </p>
      )}
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending || !hasSignature} title={!hasSignature ? "Add a signature first" : undefined}>
        {pending ? "Finalizing…" : "Finalize assignment"}
      </Button>
    </form>
  );
}
