import { diffRevisions, type RevisionDiff } from "@/lib/itps/revision-diff";
import type { ItpRevisionRow, ItpRevisionSnapshotItem, ItpRevisionSnapshotSection } from "@/lib/itps/revision-types";
import { T } from "@/components/domain/t";

const EVIDENCE_LABEL: Record<number, string> = {
  1: "Checklist",
  2: "Document upload",
  3: "Measurement",
};

type RevisionWithUser = ItpRevisionRow & { users: { full_name: string } | null };

const FIELD_LABEL: [keyof ItpRevisionSnapshotItem, string][] = [
  ["activity", "Activity"],
  ["acceptance_criteria", "Acceptance criteria"],
  ["reference_spec", "Reference"],
  ["method", "Method"],
  ["frequency", "Frequency"],
  ["evidence_type", "Evidence"],
  ["notice_hours_override", "Notice hours"],
];

function itemsOf(rev: RevisionWithUser | undefined): Map<string, ItpRevisionSnapshotItem> {
  const map = new Map<string, ItpRevisionSnapshotItem>();
  for (const section of rev?.sections_snapshot ?? []) for (const item of section.items ?? []) map.set(item.id, item);
  return map;
}

function levelsKey(item: ItpRevisionSnapshotItem | undefined): string {
  return (item?.interventions ?? [])
    .map((i) => `${i.project_party_id}:${i.intervention}`)
    .sort()
    .join("|");
}

/** What changed in `item` compared with the same activity in the previous (older) revision. */
function changeSummary(item: ItpRevisionSnapshotItem, previous: ItpRevisionSnapshotItem | undefined, hasPrevious: boolean): string | null {
  if (!hasPrevious) return null;
  if (!previous) return "new in this revision";
  const changed: string[] = [];
  for (const [key, label] of FIELD_LABEL) {
    if ((item[key] ?? null) !== (previous[key] ?? null)) changed.push(label.toLowerCase());
  }
  if (item.interventions !== undefined && previous.interventions !== undefined && levelsKey(item) !== levelsKey(previous)) {
    changed.push("sign-off levels");
  }
  return changed.length > 0 ? `changed: ${changed.join(", ")}` : null;
}

/** S2-18: what changed between this revision and the one before it, old -> new. */
function RevisionDiffBlock({ diff, olderRevision }: { diff: RevisionDiff; olderRevision: number }) {
  return (
    <div className="mt-3 rounded-md border border-border bg-off-white p-3 text-xs" data-testid="revision-diff">
      <p className="font-medium uppercase tracking-wide text-muted"><T>Changes since Rev</T> {olderRevision}</p>
      {diff.isEmpty ? (
        <p className="mt-1 text-muted"><T>No content differences were recorded.</T></p>
      ) : (
        <ul className="mt-1 space-y-1 text-ink">
          {diff.headerChanges.map((c) => (
            <li key={c.field}>
              {c.label}: <del className="text-muted">{c.before}</del> <ins className="no-underline font-medium">{c.after}</ins>
            </li>
          ))}
          {diff.addedSections.map((s) => (
            <li key={`as-${s.number}-${s.title}`}><T>+ Section</T> {s.number}. {s.title}</li>
          ))}
          {diff.removedSections.map((s) => (
            <li key={`rs-${s.number}-${s.title}`}><T>- Section</T> {s.number}. {s.title}</li>
          ))}
          {diff.renamedSections.map((s) => (
            <li key={`ns-${s.number}`}>
              <T>Section</T> {s.number}: <del className="text-muted">{s.before}</del> <ins className="no-underline font-medium">{s.after}</ins>
            </li>
          ))}
          {diff.addedItems.map((i) => (
            <li key={`ai-${i.id}`}>
              + <span className="doc-id">{i.itemNumber}</span> {i.activity} <span className="text-muted">({i.section})</span>
            </li>
          ))}
          {diff.removedItems.map((i) => (
            <li key={`ri-${i.id}`}>
              - <span className="doc-id">{i.itemNumber}</span> {i.activity} <span className="text-muted">({i.section})</span>
            </li>
          ))}
          {diff.changedItems.map((i) => (
            <li key={`ci-${i.id}`}>
              <span className="doc-id">{i.itemNumber}</span> {i.activity}
              <ul className="ms-3 list-disc text-muted">
                {i.changes.map((c) => (
                  <li key={c.field}>
                    {c.label}: <del>{c.before}</del> <ins className="no-underline font-medium text-ink">{c.after}</ins>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * R101 — a visible history table for an ITP's past revisions, sourced from itp_revisions (see
 * lib/itps/revisions.ts for what writes these rows: a baseline snapshot at initial approval, then
 * one more snapshot each time content is edited after issue). Each revision shows its full content
 * (reference, method, frequency, notice hours, sign-off level per party) and what changed compared
 * with the revision before it. Server-rendered, plain <details> per revision.
 */
export function RevisionHistoryPanel({
  revisions,
  currentRevision,
  awaitingApproval = false,
}: {
  revisions: RevisionWithUser[];
  /** The live revision number on the ITP (it isn't a snapshot row until it is itself superseded). */
  currentRevision?: number;
  /** True when the live revision still needs approval. */
  awaitingApproval?: boolean;
}) {
  if (revisions.length === 0) return null;

  return (
    <details className="group mt-4">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded border border-border px-2 py-1 text-sm font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span><T>Revision history</T> ({revisions.length})</summary>
      <p className="mt-2 text-xs text-muted">
        {currentRevision !== undefined && (
          <>
            {" "}
            <T>Current:</T> <span className="doc-id text-ink"><T>Rev</T> {currentRevision}</span>
            {awaitingApproval ? " (awaiting approval)" : ""}.
          </>
        )}
      </p>
      <ul className="mt-3 space-y-2">
        {revisions.map((rev, index) => {
          const sections: ItpRevisionSnapshotSection[] = Array.isArray(rev.sections_snapshot) ? rev.sections_snapshot : [];
          const itemCount = sections.reduce((sum, s) => sum + (s.items?.length ?? 0), 0);
          const older = revisions[index + 1];
          const previousItems = itemsOf(older);
          const removedCount = older ? [...previousItems.keys()].filter((id) => !itemsOf(rev).has(id)).length : 0;
          return (
            <li key={rev.id}>
              <details className="rounded-md border border-border">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm">
                  <span className="doc-id font-medium text-ink"><T>Rev</T> {rev.revision}</span>{" "}
                  <span className="text-muted">
                    — {new Date(rev.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    {rev.users?.full_name ? ` · ${rev.users.full_name}` : ""}
                    {rev.reason ? ` · ${rev.reason}` : ""}
                  </span>
                </summary>
                <div className="border-t border-border px-3 py-3 text-sm">
                  {older && <RevisionDiffBlock diff={diffRevisions(older, rev)} olderRevision={older.revision} />}
                  <p className="mt-3 text-ink">{rev.title}</p>
                  {rev.scope && <p className="mt-0.5 text-xs text-muted"><T>Scope:</T> {rev.scope}</p>}
                  {rev.applicable_standard && <p className="mt-0.5 text-xs text-muted">{rev.applicable_standard}</p>}
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">
                    {sections.length} {sections.length === 1 ? "section" : "sections"}, {itemCount}{" "}
                    {itemCount === 1 ? "activity" : "activities"} <T>at this revision</T>
                    {removedCount > 0 ? ` · ${removedCount} removed since Rev ${older!.revision}` : ""}
                  </p>
                  <div className="mt-2 space-y-3">
                    {sections.map((section) => (
                      <div key={section.id}>
                        <p className="text-xs font-medium text-ink">
                          {section.section_number}. {section.title}
                        </p>
                        <ul className="mt-1 space-y-1.5 ps-3">
                          {(section.items ?? []).map((item) => {
                            const change = changeSummary(item, previousItems.get(item.id), Boolean(older));
                            const detail = [
                              item.reference_spec ? `Ref: ${item.reference_spec}` : null,
                              item.method ? `Method: ${item.method}` : null,
                              item.frequency ? `Frequency: ${item.frequency}` : null,
                              item.notice_hours_override != null ? `Notice: ${item.notice_hours_override} h` : null,
                            ].filter(Boolean);
                            return (
                              <li key={item.id} className="text-xs text-muted">
                                <span className="doc-id">{item.item_number}</span> {item.activity}
                                {item.acceptance_criteria ? ` — ${item.acceptance_criteria}` : ""}
                                {" · "}
                                {EVIDENCE_LABEL[item.evidence_type] ?? "Checklist"}
                                {change && <span className="ms-1.5 rounded bg-warning/15 px-1 py-0.5 text-xs font-medium text-ink">{change}</span>}
                                {detail.length > 0 && <span className="block">{detail.join(" · ")}</span>}
                                {(item.interventions ?? []).length > 0 && (
                                  <span className="block">
                                    <T>Sign-off:</T> {(item.interventions ?? []).map((i) => `${i.party_name || "Party"} ${i.intervention}`).join(" · ")}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                          {(section.items ?? []).length === 0 && <li className="text-xs text-muted"><T>No activities in this section.</T></li>}
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
    </details>
  );
}
