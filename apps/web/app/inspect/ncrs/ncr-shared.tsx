import { cn } from "@/lib/cn";
import type { NcrSeverity, NcrStatus } from "@/lib/ncrs/types";

export const SEVERITY_TONE: Record<NcrSeverity, "danger" | "warning" | "info"> = {
  major_ncr: "danger",
  minor_ncr: "warning",
  observation: "info",
};

export const SEVERITY_LABEL: Record<NcrSeverity, string> = {
  major_ncr: "Major NCR",
  minor_ncr: "Minor NCR",
  observation: "Observation",
};

export const STATUS_TONE: Record<NcrStatus, "neutral" | "warning" | "gold" | "success"> = {
  open: "neutral",
  in_progress: "warning",
  pending_verification: "gold",
  closed: "success",
};

export const STATUS_LABEL: Record<NcrStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  pending_verification: "Pending verification",
  closed: "Closed",
};

export const TIMELINE_STEPS: { status: NcrStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "pending_verification", label: "Pending verification" },
  { status: "closed", label: "Closed" },
];

/** Presentational-only stepper derived from the NCR's existing status — no state of its own. */
export function StatusTimeline({ status }: { status: NcrStatus }) {
  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.status === status);

  return (
    <div className="flex items-center">
      {TIMELINE_STEPS.map((step, i) => {
        const isComplete = i < currentIndex || status === "closed";
        const isCurrent = i === currentIndex && status !== "closed";
        return (
          <div key={step.status} className="flex flex-1 items-center last:flex-none">
            <div className="flex w-14 flex-col items-center gap-1.5 sm:w-auto">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                  isComplete
                    ? "border-success bg-success text-white"
                    : isCurrent
                      ? "border-burgundy bg-burgundy text-white"
                      : "border-border bg-surface text-muted"
                )}
              >
                {isComplete ? "✓" : i + 1}
              </div>
              <span
                className={cn(
                  "text-center text-xs leading-tight sm:text-xs",
                  isComplete || isCurrent ? "font-medium text-ink" : "text-muted"
                )}
              >
                {step.label}
              </span>
            </div>
            {i < TIMELINE_STEPS.length - 1 && (
              <div
                className={cn("mx-1 mt-[-26px] sm:mx-2 sm:mt-[-18px] h-0.5 flex-1", isComplete ? "bg-success" : "bg-border")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Quick, no-validation transitions available from the detail page. Closing is deliberately not
// here — it only happens through the CAPA form's "Close NCR" button, which enforces the
// root-cause/corrective-action/verification requirement.
export const NEXT_STATUS: Partial<Record<NcrStatus, NcrStatus>> = {
  open: "in_progress",
  in_progress: "pending_verification",
};

export const NEXT_STATUS_LABEL: Record<NcrStatus, string> = {
  open: "",
  in_progress: "Start progress",
  pending_verification: "Send for verification",
  closed: "",
};
