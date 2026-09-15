import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { setNcrStatusAction } from "@/lib/ncrs/actions";
import { NCRS_TABLE, NCR_PHOTOS_TABLE, type NcrPhotoRow, type NcrSeverity, type NcrStatus } from "@/lib/ncrs/types";
import { CloseOutForm } from "./close-out-form";
import { NcrPhotoUpload } from "./ncr-photo-upload";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";

interface NcrDetail {
  id: string;
  ncr_number: string;
  severity: NcrSeverity;
  description: string;
  requirement_not_met: string | null;
  status: NcrStatus;
  assigned_to: string | null;
  due_date: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  verification_notes: string | null;
  closed_at: string | null;
  created_at: string;
  projects: { name: string; project_number: string; organizations: { name: string } | null } | null;
  itp_items: { item_number: string; activity: string } | null;
}

const SEVERITY_TONE: Record<NcrSeverity, "danger" | "warning" | "info"> = {
  major_ncr: "danger",
  minor_ncr: "warning",
  observation: "info",
};

const SEVERITY_LABEL: Record<NcrSeverity, string> = {
  major_ncr: "Major NCR",
  minor_ncr: "Minor NCR",
  observation: "Observation",
};

const STATUS_TONE: Record<NcrStatus, "neutral" | "warning" | "gold" | "success"> = {
  open: "neutral",
  in_progress: "warning",
  pending_verification: "gold",
  closed: "success",
};

const STATUS_LABEL: Record<NcrStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  pending_verification: "Pending verification",
  closed: "Closed",
};

const TIMELINE_STEPS: { status: NcrStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "pending_verification", label: "Pending verification" },
  { status: "closed", label: "Closed" },
];

/** Presentational-only stepper derived from the NCR's existing status — no state of its own. */
function StatusTimeline({ status }: { status: NcrStatus }) {
  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.status === status);

  return (
    <div className="flex items-center">
      {TIMELINE_STEPS.map((step, i) => {
        const isComplete = i < currentIndex || status === "closed";
        const isCurrent = i === currentIndex && status !== "closed";
        return (
          <div key={step.status} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold",
                  isComplete
                    ? "border-success bg-success text-white"
                    : isCurrent
                      ? "border-burgundy bg-burgundy text-white"
                      : "border-border bg-surface text-muted"
                )}
              >
                {isComplete ? "✓" : i + 1}
              </div>
              <span
                className={cn(
                  "whitespace-nowrap text-xs",
                  isComplete || isCurrent ? "font-medium text-ink" : "text-muted"
                )}
              >
                {step.label}
              </span>
            </div>
            {i < TIMELINE_STEPS.length - 1 && (
              <div
                className={cn("mx-2 mt-[-18px] h-0.5 flex-1", isComplete ? "bg-success" : "bg-border")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Quick, no-validation transitions available from the detail page. Closing is deliberately not
// here — it only happens through the CAPA form's "Close NCR" button, which enforces the
// root-cause/corrective-action/verification requirement.
const NEXT_STATUS: Partial<Record<NcrStatus, NcrStatus>> = {
  open: "in_progress",
  in_progress: "pending_verification",
};

const NEXT_STATUS_LABEL: Record<NcrStatus, string> = {
  open: "",
  in_progress: "Start progress",
  pending_verification: "Send for verification",
  closed: "",
};

export default async function NcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: ncr } = await supabase
    .from(NCRS_TABLE)
    .select(
      "id, ncr_number, severity, description, requirement_not_met, status, assigned_to, due_date, root_cause, corrective_action, preventive_action, verification_notes, closed_at, created_at, projects(name, project_number, organizations(name)), itp_items(item_number, activity)"
    )
    .eq("id", id)
    .maybeSingle<NcrDetail>();

  if (!ncr) notFound();

  const { data: photos } = await supabase
    .from(NCR_PHOTOS_TABLE)
    .select("*")
    .eq("ncr_id", id)
    .order("created_at")
    .returns<NcrPhotoRow[]>();

  const isClosed = ncr.status === "closed";
  const nextStatus = NEXT_STATUS[ncr.status];

  return (
    <div className="max-w-3xl">
      <RealtimeRefresh table="ncrs" filter={`id=eq.${id}`} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="doc-id text-2xl font-semibold text-ink">{ncr.ncr_number}</h1>
            <Badge tone={SEVERITY_TONE[ncr.severity]}>{SEVERITY_LABEL[ncr.severity]}</Badge>
            <Badge tone={STATUS_TONE[ncr.status]}>{STATUS_LABEL[ncr.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {ncr.projects?.organizations?.name} · {ncr.projects?.name}
            {ncr.itp_items ? ` · ITP item ${ncr.itp_items.item_number}: ${ncr.itp_items.activity}` : ""}
          </p>
        </div>

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

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <StatusTimeline status={ncr.status} />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-ink">Description</h2>
        <p className="mt-1 text-sm text-ink">{ncr.description}</p>
        {ncr.requirement_not_met && (
          <>
            <h2 className="mt-4 text-sm font-medium text-ink">Requirement not met</h2>
            <p className="mt-1 text-sm text-muted">{ncr.requirement_not_met}</p>
          </>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-ink">Photo evidence</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {(photos ?? []).map((photo) => (
            <div key={photo.id}>
              <PhotoThumbnail storagePath={photo.storage_path} caption={photo.caption} />
              {photo.caption && <p className="mt-1 truncate text-xs text-muted">{photo.caption}</p>}
            </div>
          ))}
          {(photos ?? []).length === 0 && (
            <p className="col-span-full text-sm text-muted">No photos uploaded yet.</p>
          )}
        </div>
        {!isClosed && <NcrPhotoUpload ncrId={ncr.id} />}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-medium text-ink">Corrective action close-out</h2>
        <p className="mt-1 text-sm text-muted">
          {isClosed
            ? `Closed ${ncr.closed_at ? new Date(ncr.closed_at).toLocaleDateString() : ""}.`
            : "Assign an owner and due date, then work through root cause, corrective and preventive action before closing."}
        </p>
        <div className="mt-4">
          <CloseOutForm
            ncrId={ncr.id}
            assignedTo={ncr.assigned_to}
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
  );
}
