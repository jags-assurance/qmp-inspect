import type { ItpRevisionRow } from "@/lib/itps/revision-types";

const EVIDENCE_LABEL: Record<number, string> = {
  1: "Checklist",
  2: "Document upload",
  3: "Measurement",
};

/**
 * R101 — a visible history table for an ITP's past revisions, sourced from itp_revisions (see
 * lib/itps/revisions.ts for what writes these rows: a baseline snapshot at initial approval, then
 * one more snapshot each time content is edited after issue). Server-rendered, no client state —
 * plain <details> per revision, matching this app's existing collapsible-panel pattern.
 */
export function RevisionHistoryPanel({ revisions }: { revisions: (ItpRevisionRow & { users: { full_name: string } | null })[] }) {
  if (revisions.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-ink">Revision history</h2>
      <p className="mt-1 text-xs text-muted">
        {revisions.length} recorded {revisions.length === 1 ? "revision" : "revisions"} — the content each superseded, frozen at
        the moment it changed.
      </p>
      <ul className="mt-3 space-y-2">
        {revisions.map((rev) => {
          const itemCount = rev.sections_snapshot.reduce((sum, s) => sum + s.items.length, 0);
          return (
            <li key={rev.id}>
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm">
                  <span className="doc-id font-medium text-ink">Rev {rev.revision}</span>{" "}
                  <span className="text-muted">
                    — {new Date(rev.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    {rev.users?.full_name ? ` · ${rev.users.full_name}` : ""}
                    {rev.reason ? ` · ${rev.reason}` : ""}
                  </span>
                </summary>
                <div className="border-t border-border px-3 py-3 text-sm">
                  <p className="text-ink">{rev.title}</p>
                  {rev.applicable_standard && <p className="mt-0.5 text-xs text-muted">{rev.applicable_standard}</p>}
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">
                    {rev.sections_snapshot.length} {rev.sections_snapshot.length === 1 ? "section" : "sections"}, {itemCount}{" "}
                    {itemCount === 1 ? "activity" : "activities"} at this revision
                  </p>
                  <div className="mt-2 space-y-3">
                    {rev.sections_snapshot.map((section) => (
                      <div key={section.id}>
                        <p className="text-xs font-medium text-ink">
                          {section.section_number}. {section.title}
                        </p>
                        <ul className="mt-1 space-y-1 pl-3">
                          {section.items.map((item) => (
                            <li key={item.id} className="text-xs text-muted">
                              <span className="doc-id">{item.item_number}</span> {item.activity}
                              {item.acceptance_criteria ? ` — ${item.acceptance_criteria}` : ""}
                              {" · "}
                              {EVIDENCE_LABEL[item.evidence_type] ?? "Checklist"}
                            </li>
                          ))}
                          {section.items.length === 0 && <li className="text-xs text-muted">No activities in this section.</li>}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
