import { BreadcrumbTail } from "@/components/domain/breadcrumb-context";
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
import { NcrClientAcceptancePanel } from "./ncr-client-acceptance-panel";
import { NcrDocuments } from "./ncr-documents";
import { GradeObservation } from "./grade-observation";
import { NcrPhotoUpload } from "./ncr-photo-upload";
import { EditNcrDetailsForm, EnsurePunchButton, WithdrawNcrForm } from "./ncr-extra-panels";
import { formatDateOnly, formatSiteDateTime, resolveSiteTimeZone } from "@/lib/ncrs/site-date";
import { fetchProjectTimeZone } from "@/lib/projects/timezone";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

export default async function NcrDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ warning?: string }> }) {
  const tl = await getTranslator();
  const { id } = await params;
  const { warning } = await searchParams;
  await requireSession();

  const detail = await loadNcrDetail(id);
  if (!detail) notFound();
  const { history, documents, vaultOptions, canVerify, ncr, latestNcrPdf, latestCloseoutCertificate, photos, people, responsibleParties, closeConsequences, punchItems, inspectionRecord, otherNcrs } = detail;

  // Dates and overdue are judged in the project's timezone (env site zone when none is set).
  const projectTz = await fetchProjectTimeZone(await createSupabaseServerClient(), ncr.project_id);
  const siteTz = resolveSiteTimeZone(projectTz);
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
        <T>← Back to</T> {ncr.severity === "observation" ? "Observations" : "NCR Register"}
      </Link>
      {warning === "punch" && (
        <div role="alert" className="mt-2 rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm text-ink">
          <T>This NCR was raised, but its punch-list item could not be created. Do not raise it again - use &quot;Create missing punch item&quot; below.</T>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{ncr.ncr_number}</h1>
            <BreadcrumbTail label={ncr.ncr_number} />
            <Badge tone={SEVERITY_TONE[ncr.severity]}>{SEVERITY_LABEL[ncr.severity]}</Badge>
            <Badge tone={STATUS_TONE[ncr.status]}>{STATUS_LABEL[ncr.status]}</Badge>
            {isOverdue(ncr, projectTz) && <Badge tone="danger"><T>Overdue</T></Badge>}
            {isWithdrawn && <Badge tone="neutral"><T>Withdrawn</T></Badge>}
            {ncr.due_date && <span className="text-xs text-muted"><T>Due</T> {formatDateOnly(ncr.due_date)}</span>}
            <PageGuide
              title={tl("NCR detail — how this works")}
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
                <T>Withdrawn</T>{ncr.withdrawn_reason ? `: ${ncr.withdrawn_reason}` : ""}
                {ncr.duplicate_of_ncr_id ? " (duplicate of another NCR)" : ""}
              </p>
            )}
            <h2 className="text-sm font-medium text-ink"><T>Description</T></h2>
            <p className="mt-1 text-sm text-ink">{ncr.description}</p>
            {(ncr.requirement_not_met || (extendedAvailable && (ncr.location || ncr.equipment_tag || ncr.spec_reference || categoryLabel || ncr.disposition || ncr.cost_impact != null || ncr.schedule_impact_days != null)) || (ncr.reopen_count ?? 0) > 0) && (
              <details className="group mt-3">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
                  <T>Details</T>
                </summary>
            {ncr.requirement_not_met && (
                <>
                  <h2 className="mt-4 text-sm font-medium text-ink"><T>Requirement not met</T></h2>
                  <p className="mt-1 text-sm text-muted">{ncr.requirement_not_met}</p>
                </>
              )}
              {extendedAvailable && (ncr.location || ncr.equipment_tag || ncr.spec_reference || categoryLabel || ncr.disposition || ncr.cost_impact != null || ncr.schedule_impact_days != null) && (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                  {ncr.location && (<div><dt className="text-muted"><T>Location</T></dt><dd className="text-ink">{ncr.location}</dd></div>)}
                  {ncr.equipment_tag && (<div><dt className="text-muted"><T>Equipment tag</T></dt><dd className="text-ink">{ncr.equipment_tag}</dd></div>)}
                  {ncr.spec_reference && (<div><dt className="text-muted"><T>Spec clause</T></dt><dd className="text-ink">{ncr.spec_reference}</dd></div>)}
                  {categoryLabel && (<div><dt className="text-muted"><T>Root-cause category</T></dt><dd className="text-ink">{categoryLabel}</dd></div>)}
                  {ncr.disposition && (<div><dt className="text-muted"><T>Disposition</T></dt><dd className="text-ink">{NCR_DISPOSITION_LABELS[ncr.disposition as NcrDisposition] ?? ncr.disposition}</dd></div>)}
                  {ncr.cost_impact != null && (<div><dt className="text-muted"><T>Cost impact</T></dt><dd className="text-ink">{Number(ncr.cost_impact).toLocaleString("en-GB")}</dd></div>)}
                  {ncr.schedule_impact_days != null && (<div><dt className="text-muted"><T>Schedule impact</T></dt><dd className="text-ink">{ncr.schedule_impact_days} <T>day(s)</T></dd></div>)}
                </dl>
              )}
              {(ncr.reopen_count ?? 0) > 0 && (
                <p className="mt-3 text-xs text-muted"><T>Re-opened</T> {ncr.reopen_count} <T>time(s)</T>{ncr.last_reopen_reason ? `; last reason: ${ncr.last_reopen_reason}` : ""}.</p>
              )}
              </details>
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
            <h2 className="text-base font-medium text-ink"><T>Corrective action close-out</T></h2>
            <p className="mt-1 text-sm text-muted">
              {isClosed
                ? `Closed ${ncr.closed_at ? formatSiteDateTime(ncr.closed_at, siteTz) : ""}.`
                : "Assign an owner and due date, then complete the action."}
            </p>
            {!isClosed && (
              <details className="group mt-3">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
                  <T>What closing does</T>
                </summary>
                <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted">
                  {closeConsequences.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </details>
            )}
            {ncr.severity !== "observation" && (
              <NcrClientAcceptancePanel
                ncrId={ncr.id}
                projectId={ncr.project_id}
                status={ncr.status}
                disposition={ncr.disposition ?? null}
                withdrawn={isWithdrawn}
              />
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
              <h2 className="text-sm font-medium text-ink"><T>Linked Checklist Item</T></h2>
              <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-off-white px-3 py-2">
                <span className="doc-id text-xs text-muted">{ncr.itp_items.item_number}</span>
                <span className="flex-grow truncate text-sm text-ink">{ncr.itp_items.activity}</span>
              </div>
              {ncr.inspection_record_id && (
                <Link
                  href={`/inspect/inspections/${ncr.inspection_record_id}`}
                  className="mt-2 inline-block text-xs text-burgundy hover:underline"
                >
                  <T>← View the inspection record this was raised from</T>{inspectionRecord ? ` (${inspectionRecord.record_number})` : ""}
                </Link>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-medium text-ink"><T>Punch-list item</T></h2>
            {punchItems.length === 0 ? (
              ncr.severity !== "observation" && !isClosed ? <EnsurePunchButton ncrId={ncr.id} /> : <p className="mt-2 text-sm text-muted"><T>None.</T></p>
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
              <T>Open the project punch list →</T>
            </Link>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-sm font-medium text-ink"><T>Photo evidence</T></h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {photos.map((photo) => (
                <div key={photo.id}>
                  <PhotoThumbnail url={photo.signedUrl} caption={photo.caption} />
                  {photo.caption && <p className="mt-1 truncate text-xs text-muted">{photo.caption}</p>}
                </div>
              ))}
              {photos.length === 0 && (
                <p className="col-span-full text-sm text-muted"><T>No photos uploaded yet.</T></p>
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
            <h2 className="text-sm font-medium text-ink"><T>Documents</T></h2>
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
              <h2 className="text-sm font-medium text-ink"><T>Grade to NCR</T></h2>
              <div className="mt-3">
                <GradeObservation ncrId={ncr.id} />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-4">
            <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted hover:bg-off-white [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
              <T>Activity</T> ({history.length})
            </summary>
            <ul className="mt-3 space-y-2">
              {history.map((h) => (
                <li key={h.id} className="text-xs text-ink">
                  <span className="text-muted">{formatSiteDateTime(h.created_at, siteTz)}</span> {h.summary}
                  {h.actor_name && <span className="text-muted"> - {h.actor_name}</span>}
                </li>
              ))}
              {history.length === 0 && <li className="text-sm text-muted"><T>No activity recorded yet.</T></li>}
            </ul>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
