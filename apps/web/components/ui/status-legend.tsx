import { Badge, type Tone } from "@/components/ui/badge";

/** Canonical status -> tone map. Pages should use `toneForStatus` instead of ad-hoc mappings. */
const MAP: Record<string, Tone> = {
  draft: "neutral",
  open: "neutral",
  "in progress": "warning",
  in_progress: "warning",
  pending: "warning",
  submitted: "info",
  approved: "success",
  closed: "success",
  valid: "success",
  signed: "success",
  rejected: "danger",
  expired: "danger",
  overdue: "danger",
  void: "danger",
  voided: "danger",
};

export function toneForStatus(status: string | null | undefined): Tone {
  return MAP[(status ?? "").trim().toLowerCase()] ?? "neutral";
}

const LEGEND: { tone: Tone; label: string; examples: string }[] = [
  { tone: "neutral", label: "Draft / Open", examples: "Not yet started or submitted" },
  { tone: "warning", label: "In progress / Pending", examples: "Waiting on someone" },
  { tone: "success", label: "Approved / Closed / Valid", examples: "Complete and accepted" },
  { tone: "danger", label: "Rejected / Expired / Overdue / Void", examples: "Needs attention or invalid" },
];

/** Small key explaining the status chips. Each chip carries an icon, so colour is never the only cue. */
export function StatusLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Status legend" className={`flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted ${className ?? ""}`}>
      {LEGEND.map((l) => (
        <li key={l.label} title={l.examples}>
          <Badge tone={l.tone} showIcon>
            {l.label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
