"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { SidePanel, useUrlPanel } from "@/components/ui/side-panel";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { setNcrStatusAction } from "@/lib/ncrs/actions";
import { getNcrDetailAction } from "@/lib/ncrs/detail-actions";
import type { NcrDetailData } from "@/lib/ncrs/load-detail";
import { NcrPdfButton } from "./[id]/ncr-pdf-button";
import { NcrCloseoutCertificateButton } from "./[id]/ncr-closeout-certificate-button";
import { CloseOutForm } from "./[id]/close-out-form";
import { NcrPhotoUpload } from "./[id]/ncr-photo-upload";
import {
  SEVERITY_TONE,
  SEVERITY_LABEL,
  STATUS_TONE,
  STATUS_LABEL,
  NEXT_STATUS,
  NEXT_STATUS_LABEL,
  StatusTimeline,
} from "./ncr-shared";

/**
 * Opens an NCR / Observation beside its register (`?ncr=<id>`) so it can be reviewed, edited and
 * closed out without leaving the list. Same sections as /inspect/ncrs/[id], which stays the
 * full-page / deep-link fallback.
 */
export function NcrPanel() {
  const router = useRouter();
  const panel = useUrlPanel("ncr");
  const ncrId = panel.value;
  const [detail, setDetail] = useState<NcrDetailData | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!ncrId) return;
    let cancelled = false;
    getNcrDetailAction(ncrId).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
        setDetail(null);
      } else {
        setError(null);
        setDetail(result);
      }
      setLoadedId(ncrId);
    });
    return () => {
      cancelled = true;
    };
  }, [ncrId, refreshKey]);

  // Refetch the panel and refresh the register rows behind it after any successful mutation.
  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    router.refresh();
  }, [router]);

  const loading = Boolean(ncrId) && loadedId !== ncrId;
  const ncr = !loading ? detail?.ncr : null;
  const isClosed = ncr?.status === "closed";
  const nextStatus = ncr ? NEXT_STATUS[ncr.status] : undefined;

  return (
    <SidePanel
      open={Boolean(ncrId)}
      onClose={panel.close}
      title={ncr?.ncr_number ?? "NCR"}
      description={ncr ? `${ncr.projects?.organizations?.name ?? ""} · ${ncr.projects?.name ?? ""}` : undefined}
      width="xl"
    >
      {loading && <p className="mt-6 text-sm text-muted">Loading…</p>}
      {!loading && error && (
        <div className="mt-6 text-sm">
          <p className="text-danger">{error}</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-3 min-h-11 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-off-white"
          >
            Try again
          </button>
        </div>
      )}
      {!loading && detail && ncr && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[ncr.severity]}>{SEVERITY_LABEL[ncr.severity]}</Badge>
            <Badge tone={STATUS_TONE[ncr.status]}>{STATUS_LABEL[ncr.status]}</Badge>
            <Link
              href={`/inspect/ncrs/${ncr.id}`}
              className="ml-auto inline-flex min-h-11 items-center text-sm text-burgundy hover:underline"
            >
              Open full page →
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <NcrPdfButton ncrId={ncr.id} latest={detail.latestNcrPdf} />
            {isClosed && <NcrCloseoutCertificateButton ncrId={ncr.id} latest={detail.latestCloseoutCertificate} />}
            {nextStatus && (
              <form
                action={(formData) => {
                  startTransition(async () => {
                    await setNcrStatusAction(formData);
                    refresh();
                  });
                }}
              >
                <input type="hidden" name="ncr_id" value={ncr.id} />
                <input type="hidden" name="status" value={nextStatus} />
                <button
                  type="submit"
                  disabled={pending}
                  className="min-h-11 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-off-white disabled:opacity-50"
                >
                  {NEXT_STATUS_LABEL[ncr.status]}
                </button>
              </form>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-3">
            <StatusTimeline status={ncr.status} />
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="text-sm font-medium text-ink">Description</h3>
            <p className="mt-1 break-words text-sm text-ink">{ncr.description}</p>
            {ncr.requirement_not_met && (
              <>
                <h3 className="mt-4 text-sm font-medium text-ink">Requirement not met</h3>
                <p className="mt-1 break-words text-sm text-muted">{ncr.requirement_not_met}</p>
              </>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="text-base font-medium text-ink">Corrective action close-out</h3>
            <p className="mt-1 text-sm text-muted">
              {isClosed
                ? `Closed ${ncr.closed_at ? new Date(ncr.closed_at).toLocaleDateString("en-GB") : ""}.`
                : "Assign an owner and due date, then work through root cause, corrective and preventive action before closing."}
            </p>
            {!isClosed && (
              <div className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-ink">
                <p className="font-medium">Closing this will also:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted">
                  {detail.closeConsequences.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4">
              <CloseOutForm
                key={`${ncr.id}-${ncr.status}-${ncr.closed_at ?? ""}-${ncr.root_cause ?? ""}-${ncr.corrective_action ?? ""}-${ncr.verification_notes ?? ""}-${ncr.assigned_to ?? ""}-${ncr.due_date ?? ""}`}
                ncrId={ncr.id}
                assignedTo={ncr.assigned_to}
                people={detail.people}
                responsiblePartyId={ncr.responsible_party_id}
                parties={detail.responsibleParties}
                dueDate={ncr.due_date}
                rootCause={ncr.root_cause}
                correctiveAction={ncr.corrective_action}
                preventiveAction={ncr.preventive_action}
                verificationNotes={ncr.verification_notes}
                isClosed={isClosed}
                onSaved={refresh}
              />
            </div>
          </div>

          {ncr.itp_items && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <h3 className="text-sm font-medium text-ink">Linked Checklist Item</h3>
              <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-off-white px-3 py-2">
                <span className="doc-id text-xs text-muted">{ncr.itp_items.item_number}</span>
                <span className="min-w-0 flex-grow truncate text-sm text-ink">{ncr.itp_items.activity}</span>
              </div>
              {ncr.inspection_record_id && (
                <Link
                  href={`/inspect/inspections/${ncr.inspection_record_id}`}
                  className="mt-2 inline-flex min-h-11 items-center text-xs text-burgundy hover:underline"
                >
                  ← View the inspection record this was raised from
                </Link>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="text-sm font-medium text-ink">Photo evidence</h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {detail.photos.map((photo) => (
                <div key={photo.id} className="min-w-0">
                  <PhotoThumbnail url={photo.signedUrl} caption={photo.caption} />
                  {photo.caption && <p className="mt-1 truncate text-xs text-muted">{photo.caption}</p>}
                </div>
              ))}
              {detail.photos.length === 0 && <p className="col-span-full text-sm text-muted">No photos uploaded yet.</p>}
            </div>
            {!isClosed && <NcrPhotoUpload ncrId={ncr.id} projectId={ncr.project_id} onUploaded={refresh} />}
          </div>
        </div>
      )}
    </SidePanel>
  );
}
