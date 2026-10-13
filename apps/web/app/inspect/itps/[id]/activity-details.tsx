import { Tx } from "@/components/domain/tx";

/**
 * The long text of an ITP activity (acceptance criteria, reference, method, frequency) behind one small
 * "Details" toggle, so the activity list shows just the short title and field officers open the rest
 * only when they need it.
 */
export function ActivityDetails({
  acceptanceCriteria,
  referenceSpec,
  method,
  frequency,
}: {
  acceptanceCriteria?: string | null;
  referenceSpec?: string | null;
  method?: string | null;
  frequency?: string | null;
}) {
  const rows: [string, string][] = [
    ["Acceptance", acceptanceCriteria ?? ""],
    ["Reference", referenceSpec ?? ""],
    ["Method", method ?? ""],
    ["Frequency", frequency ?? ""],
  ];
  const filled = rows.filter(([, v]) => v.trim());
  if (filled.length === 0) return null;
  return (
    <details className="group mt-1">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
        <Tx>Details</Tx>
      </summary>
      <dl className="mt-1.5 max-w-prose space-y-1 text-xs text-muted">
        {filled.map(([label, value]) => (
          <div key={label}>
            <dt className="inline font-medium text-ink"><Tx>{label}</Tx>: </dt>
            <dd className="inline [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
