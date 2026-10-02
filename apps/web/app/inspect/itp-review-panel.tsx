"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SidePanel } from "@/components/ui/side-panel";
import { loadItpPreviewAction, type ItpPreview } from "@/lib/itps/preview-actions";
import { AcceptItpForm } from "./itps/[id]/accept-itp-form";

/**
 * Review an ITP and accept it without leaving the dashboard: the full activity list with acceptance
 * criteria is shown in the panel right above the Accept button, so acceptance is never a blind
 * one-click. Who may accept is still enforced server-side by the accept_itp RPC; its error message
 * shows under the button when someone else's login isn't allowed.
 */
export function ItpReviewPanel({ itpId, onClose }: { itpId: string | null; onClose: () => void }) {
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
        <p className="mt-6 text-sm text-muted">Loading…</p>
      ) : !preview ? (
        <p className="mt-6 text-sm text-danger">Couldn&rsquo;t load this ITP. Open it from the ITPs page instead.</p>
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
                        <span className="doc-id mr-1.5 text-muted">{item.number}</span>
                        {item.activity}
                      </p>
                      {item.acceptanceCriteria && (
                        <p className="mt-0.5 text-xs text-muted">Acceptance: {item.acceptanceCriteria}</p>
                      )}
                    </li>
                  ))}
                  {section.items.length === 0 && <li className="px-3 py-2 text-xs text-muted">No activities.</li>}
                </ul>
              </section>
            ))}
            {preview.sections.length === 0 && <p className="text-sm text-muted">This ITP has no sections yet.</p>}
          </div>
          <div className="sticky bottom-0 -mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3 sm:-mx-6 sm:px-6">
            <Link href={`/inspect/itps/${itpId}`} className="text-sm text-burgundy hover:underline">
              Open full ITP page →
            </Link>
            <AcceptItpForm itpId={itpId!} />
          </div>
        </div>
      )}
    </SidePanel>
  );
}
