import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CALIBRATION_REGISTER_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
  PERSONNEL_CERTIFICATIONS_TABLE,
  type CalibrationRegisterRow,
  type CalibrationStatus,
  type WelderQualificationRegisterRow,
  type WelderQualificationStatus,
  type PersonnelCertificationRow,
  type PersonnelCertificationStatus,
} from "./types";

import { computeCalibrationStatus, computePersonnelCertificationStatus, computeWelderStatus, todayUtc } from "./status";

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
  const today = todayUtc();

  const [{ data: calibrationRows }, { data: welderRows }, { data: personnelCertRows }] = await Promise.all([
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
    supabase
      .from(PERSONNEL_CERTIFICATIONS_TABLE)
      .select("id, expiry_date, status")
      .eq("project_id", projectId)
      .returns<Pick<PersonnelCertificationRow, "id" | "expiry_date" | "status">[]>(),
  ]);

  const calibrationUpdates = (calibrationRows ?? [])
    .map((row) => ({ id: row.id, next: computeCalibrationStatus(row.due_date, today), prev: row.status }))
    .filter((row) => row.next !== row.prev);

  const welderUpdates = (welderRows ?? [])
    .map((row) => ({ id: row.id, next: computeWelderStatus(row.expiry_date, today), prev: row.status }))
    .filter((row) => row.next !== row.prev);

  const personnelCertUpdates = (personnelCertRows ?? [])
    .map((row) => ({ id: row.id, next: computePersonnelCertificationStatus(row.expiry_date, today), prev: row.status }))
    .filter((row) => row.next !== row.prev);

  await Promise.all([
    ...calibrationUpdates.map((row) =>
      supabase.from(CALIBRATION_REGISTER_TABLE).update({ status: row.next }).eq("id", row.id)
    ),
    ...welderUpdates.map((row) =>
      supabase.from(WELDER_QUALIFICATION_REGISTER_TABLE).update({ status: row.next }).eq("id", row.id)
    ),
    ...personnelCertUpdates.map((row) =>
      supabase.from(PERSONNEL_CERTIFICATIONS_TABLE).update({ status: row.next }).eq("id", row.id)
    ),
  ]);
}
