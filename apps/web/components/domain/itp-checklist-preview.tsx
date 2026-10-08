"use client";

import type { ItpChecklistPreviewItem } from "@/lib/checklists/preview";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Read-only "the checklist that goes with this ITP" — one collapsible entry per activity. Used
 * wherever someone is asked to accept or approve an ITP, so they see what the field team will be
 * held to, not only the activity names. Presentational (no hooks), so it renders in server and
 * client components alike.
 */
export function ItpChecklistPreview({ items, approved }: { items: ItpChecklistPreviewItem[]; approved: boolean }) {
  const tl = useTranslate();
  const withChecklist = items.filter((i) => i.hasChecklist);
  if (withChecklist.length === 0) {
    return <p className="rounded-md bg-off-white px-3 py-3 text-sm text-muted"><Tx>This ITP has no checklist-type activities.</Tx></p>;
  }
  return (
    <div>
      <p className="text-xs text-muted">
        {approved
          ? "The checklists below belong to this ITP and are what inspectors complete in the field."
          : "Checklists are generated from these activities when the ITP is approved. This is what each one starts from."}
      </p>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border">
        {withChecklist.map((i) => (
          <li key={i.itemId} className="px-3 py-2">
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-ink">
                <span className="min-w-0">
                  <span className="doc-id me-1.5 text-muted">{i.sectionNumber}.{i.itemNumber}</span>
                  <span className="[overflow-wrap:anywhere]">{i.activity}</span>
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {i.generated ? `${i.generated.number} · ${i.generated.lines.length} item${i.generated.lines.length === 1 ? "" : "s"}` : "to be generated"}
                </span>
              </summary>
              <ul className="mb-2 ms-1 mt-1 space-y-1 border-s-2 border-border ps-3 text-sm">
                {(i.generated?.lines.length ? i.generated.lines.map((l) => ({ text: l.text, mandatory: l.mandatory })) : i.previewLines.map((t) => ({ text: t, mandatory: true }))).map((l, idx) => (
                  <li key={idx} className="flex gap-2 text-ink">
                    <span aria-hidden="true" className="text-muted">☐</span>
                    <span className="[overflow-wrap:anywhere]">
                      {l.text}
                      {l.mandatory && <span className="ms-1 text-danger" title={tl("Mandatory")}>*</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
