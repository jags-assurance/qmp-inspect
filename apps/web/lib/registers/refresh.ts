import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CALIBRATION_REGISTER_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
  type CalibrationRegisterRow,
  type CalibrationStatus,
  type WelderQualificationRegisterRow,
  type WelderQualificationStatus,
} from "./types";

// Windows for the "due soon" / "expiring" bands, per the task spec (30/90 days). Calibration due
// dates are typically tighter-cycle than welder quals, so it gets the shorter warning window.
const CALIBRATION_DUE_SOON_DAYS = 30;
const WELDER_EXPIRING_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntil(dateStr: string, today: Date): number {
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

function computeCalibrationStatus(dueDate: string, today: Date): CalibrationStatus {
  const days = daysUntil(dueDate, today);
  if (days < 0) return "expired";
  if (days <= CALIBRATION_DUE_SOON_DAYS) return "due_soon";
  return "valid";
}

function computeWelderStatus(expiryDate: string, today: Date): WelderQualificationStatus {
  const days = daysUntil(expiryDate, today);
  if (days < 0) return "expired";
  if (days <= WELDER_EXPIRING_DAYS) return "expiring";
  return "valid";
}

/**
 * Recomputes what each register row's `status` *should* be from today's date, and updates any row
 * whose stored value has gone stale. Called at the top of the registers page load (R92-R100) — a
 * deliberately simple read-time refresh rather than a scheduled job/trigger, since a register page
 * is viewed far more often than a cron tick would need to run, and this keeps the feature entirely
 * inside normal request handling for this phase.
 *
 * material_register has no date-driven status (approval_status is set directly by whoever records
 * the submittal outcome), so there's nothing to refresh there.
 */
export async function refreshRegisterStatuses(supabase: SupabaseClient, projectId: string): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [{ data: calibrationRows }, { data: welderRows }] = await Promise.all([
    supabase
      .from(CALIBRATION_REGISTER_TABLE)
      .select("id, due_date, status")
      .eq("project_id", projectId)
      .returns<Pick<CalibrationRegisterRow, "id" | "due_date" | "status">[]>(),
    supabase
      .from(WELDER_QUALIFICATION_REGISTER_TABLE)
      .select("id, expiry_date, status")
      .eq("project_id", projectId)
      .returns<Pick<WelderQualificationRegisterRow, "id" | "expiry_date" | "status">[]>(),
  ]);

  const calibrationUpdates = (calibrationRows ?? [])
    .map((row) => ({ id: row.id, next: computeCalibrationStatus(row.due_date, today), prev: row.status }))
    .filter((row) => row.next !== row.prev);

  const welderUpdates = (welderRows ?? [])
    .map((row) => ({ id: row.id, next: computeWelderStatus(row.expiry_date, today), prev: row.status }))
    .filter((row) => row.next !== row.prev);

  await Promise.all([
    ...calibrationUpdates.map((row) =>
      supabase.from(CALIBRATION_REGISTER_TABLE).update({ status: row.next }).eq("id", row.id)
    ),
    ...welderUpdates.map((row) =>
      supabase.from(WELDER_QUALIFICATION_REGISTER_TABLE).update({ status: row.next }).eq("id", row.id)
    ),
  ]);
}
