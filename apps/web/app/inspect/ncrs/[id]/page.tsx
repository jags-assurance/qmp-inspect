import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { setNcrStatusAction } from "@/lib/ncrs/actions";
import { loadNcrDetail } from "@/lib/ncrs/load-detail";
import { NcrPdfButton } from "./ncr-pdf-button";
import { NcrCloseoutCertificateButton } from "./ncr-closeout-certificate-button";
import { CloseOutForm } from "./close-out-form";
import { NcrPhotoUpload } from "./ncr-photo-upload";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";
import {
  SEVERITY_TONE,
  SEVERITY_LABEL,
  STATUS_TONE,
  STATUS_LABEL,
  NEXT_STATUS,
  NEXT_STATUS_LABEL,
  StatusTimeline,
} from "../ncr-shared";

export default async function NcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();

  const detail = await loadNcrDetail(id);
  if (!detail) notFound();
  const { ncr, latestNcrPdf, latestCloseoutCertificate, photos, people, responsibleParties, closeConsequences } = detail;

  const isClosed = ncr.status === "closed";
  const nextStatus = NEXT_STATUS[ncr.status];

  return (
    <div className="max-w-6xl">
      <RealtimeRefresh table="ncrs" filter={`id=eq.${id}`} />
      <Link
        href={ncr.severity === "observation" ? "/inspect/observations" : "/inspect/ncrs"}
        className="text-sm text-burgundy hover:underline"
      >
        ← Back to {ncr.severity === "observation" ? "Observations" : "NCR Register"}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{ncr.ncr_number}</h1>
            <Badge tone={SEVERITY_TONE[ncr.severity]}>{SEVERITY_LABEL[ncr.severity]}</Badge>
            <Badge tone={STATUS_TONE[ncr.status]}>{STATUS_LABEL[ncr.status]}</Badge>
            <PageGuide
              title="NCR detail — how this works"
              points={[
                "\"Start progress\" / \"Send for verification\" are quick, no-validation status moves along the timeline above — closing is deliberately not one of them.",
                "Closing only happens from the corrective action close-out form, and requires root cause, corrective action and verification notes to be filled in (preventive action stays optional) — see \"Closing this will also…\" next to the form for its real side effects.",
                "\"Pending verification\" is just a status label on the timeline, not an independent approval gate — the same close-out form can close the NCR directly from Open or In progress too, and anyone with project access can fill in the CAPA fields and close it (no separate JAGS/reviewer sign-off is enforced here).",
                "\"Save progress\" (without closing) always sets the status back to In progress, even from Pending verification.",
                "The assignee and responsible-party pickers are built from real people with access to this NCR's project (access grants plus linked project parties) — not free text.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {ncr.projects?.organizations?.name} · {ncr.projects?.name}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <NcrPdfButton ncrId={ncr.id} latest={latestNcrPdf} />
          {isClosed && <NcrCloseoutCertificateButton ncrId={ncr.id} latest={latestCloseoutCertificate} />}
          {nextStatus && (
            <form action={setNcrStatusAction}>
              <input type="hidden" name="ncr_id" value={ncr.id} />
              <input type="hidden" name="status" value={nextStatus} />
              <button
                type="submit"
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white"
              >
                {NEXT_STATUS_LABEL[ncr.status]}
              </button>
            </form>
          )}
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
            <h2 className="text-sm font-medium text-ink">Description</h2>
            <p className="mt-1 text-sm text-ink">{ncr.description}</p>
            {ncr.requirement_not_met && (
              <>
                <h2 className="mt-4 text-sm font-medium text-ink">Requirement not met</h2>
                <p className="mt-1 text-sm text-muted">{ncr.requirement_not_met}</p>
              </>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <h2 className="text-base font-medium text-ink">Corrective action close-out</h2>
            <p className="mt-1 text-sm text-muted">
              {isClosed
                ? `Closed ${ncr.closed_at ? new Date(ncr.closed_at).toLocaleDateString("en-GB") : ""}.`
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
              />
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
                  ← View the inspection record this was raised from
                </Link>
              )}
            </div>
          )}

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
            {!isClosed && <NcrPhotoUpload ncrId={ncr.id} projectId={ncr.project_id} />}
          </div>
        </div>
      </div>
    </div>
  );
}
