import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { NcrStatusButton } from "./ncr-status-controls";
import { loadNcrDetail } from "@/lib/ncrs/load-detail";
import { isOverdue } from "../is-overdue";
import { NcrPdfButton } from "./ncr-pdf-button";
import { NcrCloseoutCertificateButton } from "./ncr-closeout-certificate-button";
import { CloseOutForm } from "./close-out-form";
import { NcrDocuments } from "./ncr-documents";
import { GradeObservation } from "./grade-observation";
import { NcrPhotoUpload } from "./ncr-photo-upload";
import { EditNcrDetailsForm, EnsurePunchButton, WithdrawNcrForm } from "./ncr-extra-panels";
import { formatDateOnly, formatSiteDateTime } from "@/lib/ncrs/site-date";
import { NCR_DISPOSITION_LABELS, type NcrDisposition } from "@/lib/ncrs/extended";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";
import {
  SEVERITY_TONE,
  SEVERITY_LABEL,
  STATUS_TONE,
  STATUS_LABEL,
  StatusTimeline,
} from "../ncr-shared";

export default async function NcrDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ warning?: string }> }) {
  const { id } = await params;
  const { warning } = await searchParams;
  await requireSession();

  const detail = await loadNcrDetail(id);
  if (!detail) notFound();
  const { history, documents, vaultOptions, canVerify, ncr, latestNcrPdf, latestCloseoutCertificate, photos, people, responsibleParties, closeConsequences, punchItems, inspectionRecord, otherNcrs } = detail;

  const isClosed = ncr.status === "closed";
  const isWithdrawn = Boolean(ncr.withdrawn_at);
  // `undefined` = the extended-fields migration is not applied (the select fell back to base columns).
  const extendedAvailable = "location" in ncr;
  const categoryLabel = detail.rootCauseCategories.find((c) => c.code === ncr.root_cause_category)?.label ?? ncr.root_cause_category;
  const canUploadEvidence = detail.canWork && !isClosed && !detail.capaLocked;

  return (
    <div className="max-w-6xl">
      <RealtimeRefresh table="ncrs" filter={`id=eq.${id}`} />
      <Link
        href={ncr.severity === "observation" ? "/inspect/observations" : "/inspect/ncrs"}
        className="text-sm text-burgundy hover:underline"
      >
        ← Back to {ncr.severity === "observation" ? "Observations" : "NCR Register"}
      </Link>
      {warning === "punch" && (
        <div role="alert" className="mt-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm text-ink">
          This NCR was raised, but its punch-list item could not be created. Do not raise it again - use &quot;Create missing punch item&quot; below.
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{ncr.ncr_number}</h1>
            <Badge tone={SEVERITY_TONE[ncr.severity]}>{SEVERITY_LABEL[ncr.severity]}</Badge>
            <Badge tone={STATUS_TONE[ncr.status]}>{STATUS_LABEL[ncr.status]}</Badge>
            {isOverdue(ncr) && <Badge tone="danger">Overdue</Badge>}
            {isWithdrawn && <Badge tone="neutral">Withdrawn</Badge>}
            {ncr.due_date && <span className="text-xs text-muted">Due {formatDateOnly(ncr.due_date)}</span>}
            <PageGuide
              title="NCR detail — how this works"
              points={[
                "Flow: Open, In progress, Pending verification, Closed. \"Send for verification\" needs root cause, corrective action and preventive action saved first.",
                "Sending for verification needs root cause, corrective and preventive action saved and at least one evidence photo or linked document.",
                "Only a JAGS admin or someone granted the close NCR permission verifies and closes, and not on an NCR they raised themselves, are assigned to, or wrote the corrective action for (admins may, with a written override reason). Closing needs root cause, corrective, preventive action, verification notes and evidence. JAGS staff can return a pending NCR for rework with a reason; CAPA and evidence are locked for others while it awaits verification.",
                "An NCR raised in error or as a duplicate is withdrawn (with a reason), not worked to closure; withdrawn items do not count against handover.",
                "A closed NCR can be re-opened by JAGS staff with a reason; it returns to In progress and its punch item re-opens.",
                "\"Save progress\" keeps the current status (Open becomes In progress).",
                "The assignee and responsible-party pickers are built from real people with access to this NCR's project (access grants plus linked project parties) — not free text.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {ncr.projects?.organizations?.name} · {ncr.projects?.name}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <NcrPdfButton ncrId={ncr.id} latest={latestNcrPdf} changedAt={ncr.updated_at} />
          {isClosed && <NcrCloseoutCertificateButton ncrId={ncr.id} latest={latestCloseoutCertificate} />}
          <NcrStatusButton
            ncrId={ncr.id}
            status={ncr.status}
            canWork={detail.canWork}
            capaSaved={Boolean(ncr.root_cause && ncr.corrective_action && ncr.preventive_action)}
          />
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <StatusTimeline status={ncr.status} />
      </div>

      {/* Split-pane: the CAPA record itself on the left, everything linked to it inline on the
          right — no separate page hop to check the source checklist item, referenced document, or
          activity history while working the close-out form. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-border bg-surface p-4">
            {isWithdrawn && (
              <p className="mb-3 rounded-md bg-off-white px-3 py-2 text-sm text-muted">
                Withdrawn{ncr.withdrawn_reason ? `: ${ncr.withdrawn_reason}` : ""}
                {ncr.duplicate_of_ncr_id ? " (duplicate of another NCR)" : ""}
              </p>
            )}
            <h2 className="text-sm font-medium text-ink">Description</h2>
            <p className="mt-1 text-sm text-ink">{ncr.description}</p>
            {ncr.requirement_not_met && (
              <>
                <h2 className="mt-4 text-sm font-medium text-ink">Requirement not met</h2>
                <p className="mt-1 text-sm text-muted">{ncr.requirement_not_met}</p>
              </>
            )}
            {extendedAvailable && (ncr.location || ncr.equipment_tag || ncr.spec_reference || categoryLabel || ncr.disposition || ncr.cost_impact != null || ncr.schedule_impact_days != null) && (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                {ncr.location && (<div><dt className="text-muted">Location</dt><dd className="text-ink">{ncr.location}</dd></div>)}
                {ncr.equipment_tag && (<div><dt className="text-muted">Equipment tag</dt><dd className="text-ink">{ncr.equipment_tag}</dd></div>)}
                {ncr.spec_reference && (<div><dt className="text-muted">Spec clause</dt><dd className="text-ink">{ncr.spec_reference}</dd></div>)}
                {categoryLabel && (<div><dt className="text-muted">Root-cause category</dt><dd className="text-ink">{categoryLabel}</dd></div>)}
                {ncr.disposition && (<div><dt className="text-muted">Disposition</dt><dd className="text-ink">{NCR_DISPOSITION_LABELS[ncr.disposition as NcrDisposition] ?? ncr.disposition}</dd></div>)}
                {ncr.cost_impact != null && (<div><dt className="text-muted">Cost impact</dt><dd className="text-ink">{Number(ncr.cost_impact).toLocaleString("en-GB")}</dd></div>)}
                {ncr.schedule_impact_days != null && (<div><dt className="text-muted">Schedule impact</dt><dd className="text-ink">{ncr.schedule_impact_days} day(s)</dd></div>)}
              </dl>
            )}
            {(ncr.reopen_count ?? 0) > 0 && (
              <p className="mt-3 text-xs text-muted">Re-opened {ncr.reopen_count} time(s){ncr.last_reopen_reason ? `; last reason: ${ncr.last_reopen_reason}` : ""}.</p>
            )}
            {detail.canEditDetails && (
              <EditNcrDetailsForm
                ncrId={ncr.id}
                description={ncr.description}
                requirementNotMet={ncr.requirement_not_met}
                location={ncr.location ?? null}
                equipmentTag={ncr.equipment_tag ?? null}
                specReference={ncr.spec_reference ?? null}
                showExtended={extendedAvailable}
              />
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-base font-medium text-ink">Corrective action close-out</h2>
            <p className="mt-1 text-sm text-muted">
              {isClosed
                ? `Closed ${ncr.closed_at ? formatSiteDateTime(ncr.closed_at) : ""}.`
                : "Assign an owner and due date, then work through root cause, corrective and preventive action before closing."}
            </p>
            {!isClosed && (
              <div className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-ink">
                <p className="font-medium">Closing this will also:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted">
                  {closeConsequences.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4">
              <CloseOutForm
                ncrId={ncr.id}
                assignedTo={ncr.assigned_to}
                people={people}
                responsiblePartyId={ncr.responsible_party_id}
                parties={responsibleParties}
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
                categories={extendedAvailable ? detail.rootCauseCategories : undefined}
                rootCauseCategory={ncr.root_cause_category}
                disposition={ncr.disposition}
                costImpact={ncr.cost_impact}
                scheduleImpactDays={ncr.schedule_impact_days}
                contractorResponse={ncr.contractor_response}
                selfVerifyConflict={detail.selfVerifyConflict}
                isAdmin={detail.isAdmin}
              />
              {detail.canWithdraw && <WithdrawNcrForm ncrId={ncr.id} others={otherNcrs.map((o) => ({ id: o.id, ncr_number: o.ncr_number }))} />}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {ncr.itp_items && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-sm font-medium text-ink">Linked Checklist Item</h2>
              <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-off-white px-3 py-2">
                <span className="doc-id text-xs text-muted">{ncr.itp_items.item_number}</span>
                <span className="flex-grow truncate text-sm text-ink">{ncr.itp_items.activity}</span>
              </div>
              {ncr.inspection_record_id && (
                <Link
                  href={`/inspect/inspections/${ncr.inspection_record_id}`}
                  className="mt-2 inline-block text-xs text-burgundy hover:underline"
                >
                  ← View the inspection record this was raised from{inspectionRecord ? ` (${inspectionRecord.record_number})` : ""}
                </Link>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-medium text-ink">Punch-list item</h2>
            {punchItems.length === 0 ? (
              ncr.severity !== "observation" && !isClosed ? <EnsurePunchButton ncrId={ncr.id} /> : <p className="mt-2 text-sm text-muted">None.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {punchItems.map((p) => (
                  <li key={p.id} className="text-xs">
                    <Link href={`/inspect/projects/${ncr.project_id}/punch-list?item=${p.id}`} className="text-burgundy hover:underline">
                      {p.description.slice(0, 80)}
                    </Link>{" "}
                    <span className="text-muted">({p.status}{p.due_date ? `, due ${formatDateOnly(p.due_date)}` : ""})</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/inspect/projects/${ncr.project_id}/punch-list`} className="mt-2 inline-block text-xs text-burgundy hover:underline">
              Open the project punch list →
            </Link>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-medium text-ink">Photo evidence</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {photos.map((photo) => (
                <div key={photo.id}>
                  <PhotoThumbnail url={photo.signedUrl} caption={photo.caption} />
                  {photo.caption && <p className="mt-1 truncate text-xs text-muted">{photo.caption}</p>}
                </div>
              ))}
              {photos.length === 0 && (
                <p className="col-span-full text-sm text-muted">No photos uploaded yet.</p>
              )}
            </div>
            {canUploadEvidence && <NcrPhotoUpload ncrId={ncr.id} projectId={ncr.project_id} />}
            {!canUploadEvidence && !isClosed && (
              <p className="mt-3 text-xs text-muted">
                {detail.capaLocked ? "Evidence is locked while the NCR awaits verification." : "Only the raiser, the assignee, the responsible party or JAGS staff can add evidence."}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-medium text-ink">Documents</h2>
            <div className="mt-3">
              <NcrDocuments
                ncrId={ncr.id}
                projectId={ncr.project_id}
                documents={documents}
                vaultOptions={vaultOptions}
                readOnly={isClosed || !canUploadEvidence}
              />
            </div>
          </div>

          {canVerify && ncr.severity === "observation" && !isClosed && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-sm font-medium text-ink">Grade to NCR</h2>
              <div className="mt-3">
                <GradeObservation ncrId={ncr.id} />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-medium text-ink">Activity</h2>
            <ul className="mt-3 space-y-2">
              {history.map((h) => (
                <li key={h.id} className="text-xs text-ink">
                  <span className="text-muted">{formatSiteDateTime(h.created_at)}</span> {h.summary}
                  {h.actor_name && <span className="text-muted"> - {h.actor_name}</span>}
                </li>
              ))}
              {history.length === 0 && <li className="text-sm text-muted">No activity recorded yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
