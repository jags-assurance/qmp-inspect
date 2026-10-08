"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SidePanel } from "@/components/ui/side-panel";
import { loadItpPreviewAction, type ItpPreview } from "@/lib/itps/preview-actions";
import { AcceptItpForm } from "./itps/[id]/accept-itp-form";
import { ItpChecklistPreview } from "@/components/domain/itp-checklist-preview";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Review an ITP and accept it without leaving the dashboard: the full activity list with acceptance
 * criteria is shown in the panel right above the Accept button, so acceptance is never a blind
 * one-click. Who may accept is still enforced server-side by the accept_itp RPC; its error message
 * shows under the button when someone else's login isn't allowed.
 */
export function ItpReviewPanel({ itpId, onClose }: { itpId: string | null; onClose: () => void }) {
  const tl = useTranslate();
  const [loaded, setLoaded] = useState<{ id: string; preview: ItpPreview | null } | null>(null);

  useEffect(() => {
    if (!itpId) return;
    let cancelled = false;
    loadItpPreviewAction(itpId)
      .then((preview) => !cancelled && setLoaded({ id: itpId, preview }))
      .catch(() => !cancelled && setLoaded({ id: itpId, preview: null }));
    return () => {
      cancelled = true;
    };
  }, [itpId]);

  const ready = itpId && loaded?.id === itpId ? loaded : null;
  const preview = ready?.preview ?? null;

  return (
    <SidePanel
      open={!!itpId}
      onClose={onClose}
      title={preview ? `${preview.itpNumber} — ${preview.title}` : "Review ITP"}
      description={preview?.projectName ?? undefined}
      width="xl"
      guardUnsaved={false}
    >
      {!ready ? (
        <p className="mt-6 text-sm text-muted"><Tx>Loading…</Tx></p>
      ) : !preview ? (
        <p className="mt-6 text-sm text-danger"><Tx>Couldn&rsquo;t load this ITP. Open it from the ITPs page instead.</Tx></p>
      ) : (
        <div className="mt-4">
          <div className="space-y-4">
            {preview.sections.map((section) => (
              <section key={section.id}>
                <h3 className="text-sm font-semibold text-ink">
                  {section.number}. {section.title}
                </h3>
                <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                  {section.items.map((item) => (
                    <li key={item.id} className="px-3 py-2 text-sm">
                      <p className="text-ink">
                        <span className="doc-id me-1.5 text-muted">{item.number}</span>
                        {item.activity}
                      </p>
                      {item.acceptanceCriteria && (
                        <p className="mt-0.5 text-xs text-muted"><Tx>Acceptance:</Tx> {item.acceptanceCriteria}</p>
                      )}
                    </li>
                  ))}
                  {section.items.length === 0 && <li className="px-3 py-2 text-xs text-muted"><Tx>No activities.</Tx></li>}
                </ul>
              </section>
            ))}
            {preview.sections.length === 0 && <p className="text-sm text-muted"><Tx>This ITP has no sections yet.</Tx></p>}
          </div>
          <section className="mt-6" aria-label={tl("Checklist")}>
            <h3 className="text-sm font-semibold text-ink"><Tx>Checklist that goes with this ITP</Tx></h3>
            <div className="mt-2">
              <ItpChecklistPreview items={preview.checklists} approved={preview.status === "approved" || preview.status === "client_accepted"} />
            </div>
          </section>
          <div className="sticky bottom-0 -mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3 sm:-mx-6 sm:px-6">
            <Link href={`/inspect/itps/${itpId}`} className="text-sm text-burgundy hover:underline">
              <Tx>Open full ITP page →</Tx>
            </Link>
            <AcceptItpForm itpId={itpId!} requiresChecklistReview={preview.checklists.some((c) => c.hasChecklist)} />
          </div>
        </div>
      )}
    </SidePanel>
  );
}
