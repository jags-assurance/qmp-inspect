import { T } from "@/components/domain/t";
import { Tx } from "@/components/domain/tx";
import { Badge, type Tone } from "@/components/ui/badge";
import type { OutstandingActions } from "@/lib/itps/workspace";
import { OpenActivityLink } from "./activity-panel-item";

const REASON_LABEL = {
  hold: "Hold open",
  your_signoff: "Your sign-off",
  to_notify: "To notify",
  evidence: "Evidence missing",
} as const;

const REASON_TONE: Record<keyof typeof REASON_LABEL, Tone> = {
  hold: "danger",
  your_signoff: "warning",
  to_notify: "gold",
  evidence: "warning",
};

/**
 * "What needs attention" for this ITP: counts of what is outstanding and links straight to the activities
 * concerned (the workspace opens the activity a link points at). Nothing here changes any data; the actions
 * themselves stay on each activity, behind the same permissions. Renders nothing when nothing is outstanding.
 */
export function OutstandingActionsPanel({ outstanding }: { outstanding: OutstandingActions }) {
  const all: { key: string; label: string; value: number; tone: Tone }[] = [
    { key: "your", label: "Your sign-offs", value: outstanding.yourSignoffs, tone: "warning" },
    { key: "holds", label: "Hold points open", value: outstanding.holdsOpen, tone: "danger" },
    { key: "notify", label: "Sign-offs to notify", value: outstanding.toNotify, tone: "gold" },
    { key: "waiting", label: "Waiting for a party", value: outstanding.awaitingParty, tone: "info" },
    { key: "evidence", label: "Activities missing evidence", value: outstanding.evidenceMissing, tone: "warning" },
    { key: "records", label: "Test records outstanding", value: outstanding.recordsOutstanding, tone: "neutral" },
  ];
  const stats = all.filter((s) => s.value > 0);
  if (stats.length === 0) return null;
  return (
    <section aria-label="Outstanding actions" className="mt-4 rounded-lg border border-border bg-surface p-3 shadow-xs sm:p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted"><T>Needs attention</T></h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {stats.map((s) => (
          <li key={s.key}>
            <Badge tone={s.tone}>
              <span className="tabular-nums">{s.value}</span> <Tx>{s.label}</Tx>
            </Badge>
          </li>
        ))}
      </ul>
      {outstanding.jumpTargets.length > 0 && (
        <ul className="mt-3 divide-y divide-border text-sm">
          {outstanding.jumpTargets.map((t) => (
            <li key={t.itemId}>
              <OpenActivityLink id={t.itemId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-ink hover:text-brand [@media(pointer:coarse)]:min-h-11">
                <span className="doc-id text-xs text-muted">{t.itemNumber}</span>
                <span className="min-w-0 flex-1 truncate" title={t.activity}>{t.activity}</span>
                <Badge tone={REASON_TONE[t.reason]}><Tx>{REASON_LABEL[t.reason]}</Tx></Badge>
              </OpenActivityLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
