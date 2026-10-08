// Admin alert for background jobs that failed PERMANENTLY (final attempt used up, a permanent error,
// a timeout, or an orphan that ran out of attempts). Admins are the organisation's JAGS admin staff, the
// same recipients the automation sweep uses (getOrgAdminUserIds); the alert is an ordinary notification,
// so the notifications_enqueue_email trigger (migration 20261104000300) queues the email through
// email_outbox exactly like every other notification.
//
// Exactly once per job: failure_notified_at (migration 20261122000100) is claimed with a conditional
// UPDATE ... WHERE failure_notified_at IS NULL before anything is sent, so the immediate path, the
// periodic catch-up sweep and a second replica cannot all notify. If the column is not migrated yet the
// job id embedded in the notification link is the dedupe key instead. Nothing here ever throws: a
// failing alert must not disturb the job loop.
import { supabase } from "../supabase";
import { getOrgAdminUserIds, notify } from "../automation";
import {
  buildFailureAlert,
  isMissingFailureColumn,
  scopeFromPayload,
  shouldAlertOnFailure,
  failureAlertLink,
  type FailedJobFacts,
} from "./jobFailurePolicy";

// background_jobs / notifications are outside the generated Database type (same escape hatch as automation.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
const db = supabase as any;

export interface FailedJobRow extends FailedJobFacts {
  payload: Record<string, unknown> | null;
}

/** Entity id in a job payload -> table that maps it to a project. Best effort: jobs without an organisation_id in their payload. */
const ENTITY_TABLES: [payloadKey: string, table: string][] = [
  ["itp_id", "itps"],
  ["ncr_id", "ncrs"],
  ["inspection_record_id", "inspection_records"],
  ["data_book_id", "data_books"],
  ["assignment_id", "standalone_assignments"],
  ["irn_id", "irns"],
];

async function resolveScope(payload: Record<string, unknown> | null): Promise<{ organizationId: string | null; projectId: string | null; projectLabel: string | null }> {
  let { organizationId, projectId } = scopeFromPayload(payload);
  if (!projectId && payload) {
    for (const [key, table] of ENTITY_TABLES) {
      const id = payload[key];
      if (typeof id !== "string") continue;
      try {
        const { data } = await db.from(table).select("project_id").eq("id", id).maybeSingle();
        if (data?.project_id) {
          projectId = data.project_id as string;
          break;
        }
      } catch {
        /* unknown table / no access: try the next key */
      }
    }
  }
  let projectLabel: string | null = null;
  if (projectId) {
    try {
      const { data } = await db.from("projects").select("organization_id, project_number, name").eq("id", projectId).maybeSingle();
      if (data) {
        organizationId = organizationId ?? (data.organization_id as string | null);
        projectLabel = [data.project_number, data.name].filter(Boolean).join(" ") || null;
      }
    } catch {
      /* label is optional */
    }
  }
  return { organizationId, projectId, projectLabel };
}

/** Atomically claims the right to notify. true = this caller owns the alert; false = already notified (or not failed). */
async function claimFailureNotification(jobId: string): Promise<"claimed" | "already" | "no-column"> {
  const { data, error } = await db
    .from("background_jobs")
    .update({ failure_notified_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "failed")
    .is("failure_notified_at", null)
    .select("id");
  if (error) {
    if (isMissingFailureColumn(error)) return "no-column";
    throw new Error(`Could not claim failure notification: ${error.message}`);
  }
  return Array.isArray(data) && data.length > 0 ? "claimed" : "already";
}

async function releaseClaim(jobId: string): Promise<void> {
  await db.from("background_jobs").update({ failure_notified_at: null }).eq("id", jobId).eq("status", "failed");
}

/** Pre-migration dedupe: has an alert for this job already been written? */
async function alertAlreadyWritten(jobId: string): Promise<boolean> {
  const { data, error } = await db.from("notifications").select("id").eq("link", failureAlertLink(jobId)).limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Notifies the organisation's admins that `job` failed permanently. Call only after the job row was
 * actually moved to 'failed'. Returns true when an alert was written by this call. Never throws.
 */
export async function alertPermanentJobFailure(job: FailedJobRow): Promise<boolean> {
  let claimedHere = false;
  try {
    if (!shouldAlertOnFailure({ ...job, status: "failed" })) return false;

    const claim = await claimFailureNotification(job.id);
    if (claim === "already") return false;
    claimedHere = claim === "claimed";
    if (claim === "no-column" && (await alertAlreadyWritten(job.id))) return false;

    const { organizationId, projectId, projectLabel } = await resolveScope(job.payload);
    if (!organizationId) {
      console.warn(`[worker] Job ${job.id} (${job.job_type}) failed permanently but its organisation could not be resolved; no admin alert sent.`);
      return false;
    }
    const admins = await getOrgAdminUserIds(organizationId);
    if (admins.length === 0) {
      console.warn(`[worker] Job ${job.id} (${job.job_type}) failed permanently but organisation ${organizationId} has no admin to notify.`);
      return false;
    }

    const alert = buildFailureAlert(job, projectLabel);
    let sent = 0;
    for (const adminId of admins) {
      try {
        await notify(organizationId, projectId, adminId, alert.title, alert.body, alert.link);
        sent += 1;
      } catch (err) {
        console.error(`[worker] Failed to notify admin about job ${job.id}:`, err instanceof Error ? err.message : err);
      }
    }
    if (sent === 0) {
      // Nobody was told: give the claim back so the catch-up sweep can try again.
      if (claimedHere) await releaseClaim(job.id).catch(() => undefined);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[worker] Admin alert for failed job ${job.id} errored:`, err instanceof Error ? err.message : err);
    if (claimedHere) await releaseClaim(job.id).catch(() => undefined);
    return false;
  }
}

const SWEEP_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const SWEEP_LIMIT = 20;

/**
 * Catch-up: jobs that failed (orphan reclaim, a crash between markFailed and the alert, a send that
 * failed) but whose admins were never told. Looks back a few hours only. A quiet no-op until the
 * failure_notified_at column exists (the select errors), so it cannot spam before the migration.
 */
export async function sweepUnnotifiedFailedJobs(): Promise<number> {
  try {
    const since = new Date(Date.now() - SWEEP_LOOKBACK_MS).toISOString();
    const { data, error } = await db
      .from("background_jobs")
      .select("id, job_type, status, attempts, error_message, payload, failure_notified_at")
      .eq("status", "failed")
      .is("failure_notified_at", null)
      .gte("completed_at", since)
      .order("completed_at", { ascending: true })
      .limit(SWEEP_LIMIT);
    if (error || !Array.isArray(data)) return 0;
    let sent = 0;
    for (const row of data as FailedJobRow[]) {
      if (await alertPermanentJobFailure(row)) sent += 1;
    }
    return sent;
  } catch (err) {
    console.error("[worker] Failed-job alert sweep errored:", err instanceof Error ? err.message : err);
    return 0;
  }
}
