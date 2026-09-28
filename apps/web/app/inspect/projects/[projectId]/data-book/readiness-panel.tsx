import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { DataBookReadiness } from "@/lib/databook/readiness";

function ProgressBar({ percentage, tone }: { percentage: number; tone: "success" | "warning" }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted/15">
      <div
        className={cn("h-full rounded-full transition-all", tone === "success" ? "bg-success" : "bg-gold")}
        style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
      />
    </div>
  );
}

function CategoryRow({ label, ready, total, percentage }: { label: string; ready: number; total: number; percentage: number }) {
  // Real gap found live: total===0 computes as percentage 100 (nothing outstanding, so it doesn't
  // block compilation — see readiness.ts's own doc comment, that gating logic is correct and
  // unchanged), but showing a plain "100%" success badge when there are literally zero ITPs/NCRs/
  // etc. on the project reads as "fully verified" when really nothing has happened yet. Distinguish
  // the two in the DISPLAY only: an empty category shows a neutral "No items yet" instead.
  const isEmpty = total === 0;
  const badgeTone: "success" | "warning" | "neutral" = isEmpty ? "neutral" : percentage === 100 ? "success" : "warning";
  const barTone: "success" | "warning" = !isEmpty && percentage === 100 ? "success" : "warning";
  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink">{label}</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">
            {ready}/{total}
          </span>
          <Badge tone={badgeTone}>{isEmpty ? "No items yet" : `${percentage}%`}</Badge>
        </div>
      </div>
      <div className="mt-2">
        <ProgressBar percentage={percentage} tone={barTone} />
      </div>
    </div>
  );
}

export function ReadinessPanel({ readiness }: { readiness: DataBookReadiness }) {
  // Same "empty ≠ verified" distinction as CategoryRow, applied to the overall summary — every
  // gating category having zero items (a brand-new project) shouldn't read as a confident "100%
  // overall" success badge.
  const nothingProvisionedYet = [
    readiness.itps,
    readiness.inspectionRecords,
    readiness.checklists,
    readiness.calibrationRegister,
    readiness.welderRegister,
    readiness.materialRegister,
    readiness.ncrs,
  ].every((c) => c.total === 0);
  const overallTone = nothingProvisionedYet ? "neutral" : readiness.overallPercentage === 100 ? "success" : "warning";
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ink">Compilation readiness</h2>
        <Badge tone={overallTone}>{nothingProvisionedYet ? "No data yet" : `${readiness.overallPercentage}% overall`}</Badge>
      </div>
      <div className="mt-2">
        <ProgressBar percentage={readiness.overallPercentage} tone={overallTone === "success" ? "success" : "warning"} />
      </div>

      <div className="mt-4">
        <CategoryRow {...readiness.itps} />
        <CategoryRow {...readiness.inspectionRecords} />
        <CategoryRow {...readiness.checklists} />
        <CategoryRow {...readiness.calibrationRegister} />
        <CategoryRow {...readiness.welderRegister} />
        <CategoryRow {...readiness.materialRegister} />
        <CategoryRow {...readiness.ncrs} />
        <div className="flex items-center justify-between py-3">
          <span className="text-sm text-ink">Open punch list items</span>
          <Badge tone={readiness.openPunchItems === 0 ? "success" : "danger"}>
            {readiness.openPunchItems} open
          </Badge>
        </div>
        <div className="flex items-center justify-between border-t border-border py-3">
          <span className="text-sm text-muted">Handover certificate issued</span>
          <span className="text-xs text-muted">
            {readiness.handoverCertificate.ready}/{readiness.handoverCertificate.total} — the outcome of
            compiling, not a precondition
          </span>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted">
        Overall % = total items provided ÷ total items required, summed across every category above
        (handover certificate excluded — it's produced by compiling, not required to compile).
      </p>

      {!readiness.isReady && (
        <p className="mt-1 text-xs text-muted">
          Every category must reach 100% and the punch list must have zero open items before a Data Book can
          compile. A staff user can compile anyway with a documented override reason — see below.
        </p>
      )}
    </div>
  );
}
