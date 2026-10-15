"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { SidePanel, useUrlPanel } from "@/components/ui/side-panel";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { NcrStatusButton } from "./[id]/ncr-status-controls";
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
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

type TabId = "overview" | "closeout" | "evidence" | "history" | "related";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "closeout", label: "Close-out" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" },
  { id: "related", label: "Related" },
];
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

/**
 * Opens an NCR / Observation beside its register (`?ncr=<id>`) so it can be reviewed, edited and
 * closed out without leaving the list. Same sections as /inspect/ncrs/[id], which stays the
 * full-page / deep-link fallback.
 */
export function NcrPanel() {
  const tl = useTranslate();
  const router = useRouter();
  const panel = useUrlPanel("ncr");
  const ncrId = panel.value;
  const [detail, setDetail] = useState<NcrDetailData | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<TabId>("overview");
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

  const personName = (id: string | null) => (id ? detail?.people.find((p) => p.id === id)?.name ?? null : null);
  const onTabKey = (e: React.KeyboardEvent, id: TabId) => {
    const i = TABS.findIndex((t) => t.id === id);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TABS[(i + d + TABS.length) % TABS.length].id;
    setTab(next);
    document.getElementById(`ncr-tab-${next}`)?.focus();
  };

  return (
    <SidePanel
      open={Boolean(ncrId)}
      onClose={panel.close}
      title={ncr?.ncr_number ?? "NCR"}
      description={ncr ? `${ncr.projects?.organizations?.name ?? ""} · ${ncr.projects?.name ?? ""}` : undefined}
      width="xl"
    >
      {loading && <p className="mt-6 text-sm text-muted"><Tx>Loading…</Tx></p>}
      {!loading && error && (
        <div className="mt-6 text-sm">
          <p className="text-danger">{error}</p>
          <Button
            type="button"
            onClick={refresh}
            variant="outline" className="mt-3"
          >
            <Tx>Try again</Tx>
          </Button>
        </div>
      )}
      {!loading && detail && ncr && (
        <div className="@container mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[ncr.severity]}>{SEVERITY_LABEL[ncr.severity]}</Badge>
            <Badge tone={STATUS_TONE[ncr.status]}>{STATUS_LABEL[ncr.status]}</Badge>
            <Link
              href={`/inspect/ncrs/${ncr.id}`}
              className="ms-auto inline-flex min-h-11 items-center text-sm text-burgundy hover:underline"
            >
              <Tx>Open full page →</Tx>
            </Link>
          </div>

          <div
            role="tablist"
            aria-label={tl("NCR sections")}
            className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`ncr-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`ncr-section-${t.id}`}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, t.id)}
                className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium ${
                  tab === t.id ? "border-burgundy text-burgundy" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 @3xl:grid-cols-2">
            {/* Overview */}
            <section
              id="ncr-section-overview"
              role="tabpanel"
              aria-labelledby="ncr-tab-overview"
              className={`min-w-0 space-y-4 ${tab === "overview" ? "block" : tab === "closeout" ? "hidden @3xl:block" : "hidden"}`}
            >
              <div className="rounded-lg border border-border bg-surface p-3">
                <StatusTimeline status={ncr.status} />
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="text-sm font-medium text-ink"><Tx>Description</Tx></h3>
                <p className="mt-1 break-words text-sm text-ink">{ncr.description}</p>
                {ncr.requirement_not_met && (
                  <>
                    <h3 className="mt-4 text-sm font-medium text-ink"><Tx>Requirement not met</Tx></h3>
                    <p className="mt-1 break-words text-sm text-muted">{ncr.requirement_not_met}</p>
                  </>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted"><Tx>Assigned to</Tx></dt>
                  <dd className="break-words text-ink">{personName(ncr.assigned_to) ?? "Unassigned"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted"><Tx>Responsible party</Tx></dt>
                  <dd className="break-words text-ink">
                    {detail.responsibleParties.find((p) => p.id === ncr.responsible_party_id)?.name ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted"><Tx>Due</Tx></dt>
                  <dd className="text-ink">{fmtDate(ncr.due_date)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted"><Tx>Raised</Tx></dt>
                  <dd className="text-ink">{fmtDate(ncr.created_at)}</dd>
                </div>
                {ncr.closed_at && (
                  <div>
                    <dt className="text-xs text-muted"><Tx>Closed</Tx></dt>
                    <dd className="text-ink">{fmtDate(ncr.closed_at)}</dd>
                  </div>
                )}
                <div className="min-w-0">
                  <dt className="text-xs text-muted"><Tx>Project</Tx></dt>
                  <dd className="break-words text-ink">{ncr.projects?.name ?? "—"}</dd>
                </div>
              </dl>
            </section>

            {/* Close-out */}
            <section
              id="ncr-section-closeout"
              role="tabpanel"
              aria-labelledby="ncr-tab-closeout"
              className={`min-w-0 space-y-4 ${tab === "closeout" || tab === "overview" ? (tab === "closeout" ? "block" : "hidden @3xl:block") : "hidden"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <NcrPdfButton ncrId={ncr.id} latest={detail.latestNcrPdf} changedAt={detail.ncr.updated_at} />
                {isClosed && <NcrCloseoutCertificateButton ncrId={ncr.id} latest={detail.latestCloseoutCertificate} />}
                <NcrStatusButton
                  ncrId={ncr.id}
                  status={ncr.status}
                  canWork={detail.canWork}
                  capaSaved={Boolean(ncr.root_cause && ncr.corrective_action && ncr.preventive_action)}
                  onDone={refresh}
                />
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="text-base font-medium text-ink"><Tx>Corrective action close-out</Tx></h3>
                <p className="mt-1 text-sm text-muted">
                  {isClosed
                    ? `Closed ${ncr.closed_at ? new Date(ncr.closed_at).toLocaleDateString("en-GB") : ""}.`
                    : "Assign an owner and due date, then work through root cause, corrective and preventive action before closing."}
                </p>
                {!isClosed && (
                  <div className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-ink">
                    <p className="font-medium"><Tx>Closing this will also:</Tx></p>
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
                    status={ncr.status}
                    canVerify={detail.canVerify}
                    canClose={detail.canClose}
                    canAssign={detail.canAssign}
                    capaLocked={detail.capaLocked}
                    photoCount={detail.evidenceTotal}
                    onSaved={refresh}
                  />
                </div>
              </div>
            </section>

            {/* Evidence */}
            <section
              id="ncr-section-evidence"
              role="tabpanel"
              aria-labelledby="ncr-tab-evidence"
              className={`min-w-0 space-y-4 @3xl:col-span-2 ${tab === "evidence" ? "block" : "hidden"}`}
            >
              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="text-sm font-medium text-ink"><Tx>Photo evidence</Tx></h3>
                <div className="mt-3 grid grid-cols-2 gap-3 @3xl:grid-cols-4">
                  {detail.photos.map((photo) => (
                    <div key={photo.id} className="min-w-0">
                      <PhotoThumbnail url={photo.signedUrl} caption={photo.caption} />
                      {photo.caption && <p className="mt-1 truncate text-xs text-muted">{photo.caption}</p>}
                    </div>
                  ))}
                  {detail.photos.length === 0 && <p className="col-span-full text-sm text-muted"><Tx>No photos uploaded yet.</Tx></p>}
                </div>
                {!isClosed && <NcrPhotoUpload ncrId={ncr.id} projectId={ncr.project_id} onUploaded={refresh} />}
              </div>
              {detail.punchItems.some((p) => p.closing_evidence) && (
                <div className="rounded-lg border border-border bg-surface p-4">
                  <h3 className="text-sm font-medium text-ink"><Tx>Punch item closing evidence</Tx></h3>
                  <ul className="mt-2 space-y-2">
                    {detail.punchItems
                      .filter((p) => p.closing_evidence)
                      .map((p) => (
                        <li key={p.id} className="break-words rounded-md bg-off-white px-3 py-2 text-sm text-ink">
                          {p.closing_evidence}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </section>

            {/* History */}
            <section
              id="ncr-section-history"
              role="tabpanel"
              aria-labelledby="ncr-tab-history"
              className={`min-w-0 space-y-4 @3xl:col-span-2 ${tab === "history" ? "block" : "hidden"}`}
            >
              <div className="rounded-lg border border-border bg-surface p-3">
                <StatusTimeline status={ncr.status} />
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="text-sm font-medium text-ink"><Tx>Activity</Tx></h3>
                {detail.history.length === 0 ? (
                  <p className="mt-2 text-sm text-muted"><Tx>No recorded activity yet.</Tx></p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {detail.history.map((e) => (
                      <li key={e.id} className="py-2 text-sm">
                        <p className="break-words text-ink">{e.summary}</p>
                        <p className="text-xs text-muted">
                          {e.actor_name ?? "System"} · {new Date(e.created_at).toLocaleString("en-GB")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Related */}
            <section
              id="ncr-section-related"
              role="tabpanel"
              aria-labelledby="ncr-tab-related"
              className={`min-w-0 space-y-4 @3xl:col-span-2 ${tab === "related" ? "block" : "hidden"}`}
            >
              {ncr.itp_items && (
                <div className="rounded-lg border border-border bg-surface p-4">
                  <h3 className="text-sm font-medium text-ink"><Tx>Linked Checklist Item</Tx></h3>
                  <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-off-white px-3 py-2">
                    <span className="doc-id text-xs text-muted">{ncr.itp_items.item_number}</span>
                    <span className="min-w-0 flex-grow truncate text-sm text-ink">{ncr.itp_items.activity}</span>
                  </div>
                </div>
              )}
              {detail.inspectionRecord && (
                <div className="rounded-lg border border-border bg-surface p-4">
                  <h3 className="text-sm font-medium text-ink"><Tx>Inspection record</Tx></h3>
                  <p className="mt-2 break-words text-sm text-ink">
                    <span className="doc-id text-xs text-muted">{detail.inspectionRecord.record_number}</span>{" "}
                    {detail.inspectionRecord.activity}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    <Tx>Result:</Tx> {detail.inspectionRecord.overall_result ?? "pending"} · {fmtDate(detail.inspectionRecord.inspection_date)}
                  </p>
                  <Link
                    href={`/inspect/inspections/${detail.inspectionRecord.id}`}
                    className="mt-1 inline-flex min-h-11 items-center text-xs text-burgundy hover:underline"
                  >
                    <Tx>← View the inspection record this was raised from</Tx>
                  </Link>
                </div>
              )}
              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="text-sm font-medium text-ink"><Tx>Punch list items</Tx></h3>
                {detail.punchItems.length === 0 ? (
                  <p className="mt-2 text-sm text-muted"><Tx>None linked.</Tx></p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.punchItems.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md bg-off-white px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 break-words text-ink">{p.description}</span>
                        <Badge tone={p.status === "closed" ? "success" : p.status === "resolved" ? "gold" : "warning"}>
                          {p.status}
                        </Badge>
                        {p.due_date && <span className="text-xs text-muted"><Tx>Due</Tx> {fmtDate(p.due_date)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="text-sm font-medium text-ink"><Tx>Also on this project</Tx></h3>
                {detail.otherNcrs.length === 0 ? (
                  <p className="mt-2 text-sm text-muted"><Tx>No other open NCRs.</Tx></p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {detail.otherNcrs.map((o) => (
                      <li key={o.id}>
                        <Button
                          type="button"
                          onClick={() => {
                            setTab("overview");
                            panel.open(o.id);
                          }}
                          variant="outline" className="flex w-full"
                        >
                          <span className="doc-id text-ink">{o.ncr_number}</span>
                          <Badge tone={SEVERITY_TONE[o.severity]}>{SEVERITY_LABEL[o.severity]}</Badge>
                          <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
