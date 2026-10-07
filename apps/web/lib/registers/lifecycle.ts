// Verification + lifecycle helpers shared by the register screens, the soft-stop and Data Book readiness
// (S3-01 / S3-04). Pure and column-tolerant: a row read before migration 20261103000100 has no
// verified_at / lifecycle_status, and is treated as verified + active (the behaviour before the migration).

export const REGISTER_LIFECYCLE_STATUSES = ["active", "superseded", "retired", "withdrawn"] as const;
export type RegisterLifecycleStatus = (typeof REGISTER_LIFECYCLE_STATUSES)[number];

export interface RegisterRowMeta {
  verified_at?: string | null;
  lifecycle_status?: string | null;
}

/** Postgres / PostgREST codes meaning "that column / function / table isn't in the database yet". */
const MISSING_DB_OBJECT_CODES = new Set(["42883", "42703", "42P01", "PGRST202", "PGRST204", "PGRST205"]);

export function isMissingDbObject(error: { code?: string | null } | null | undefined): boolean {
  return !!error?.code && MISSING_DB_OBJECT_CODES.has(error.code);
}

/** Unverified only when the column exists AND is null (undefined = column not deployed yet = trusted). */
export function isRegisterRowVerified(row: RegisterRowMeta): boolean {
  return row.verified_at === undefined || row.verified_at !== null;
}

export function isRegisterRowActive(row: RegisterRowMeta): boolean {
  return !row.lifecycle_status || row.lifecycle_status === "active";
}

/**
 * Whether a row counts toward verification and Data Book readiness: active (not superseded / retired /
 * withdrawn) and verified by JAGS staff. Readiness should use this as its row filter.
 */
export function isRegisterRowCounted(row: RegisterRowMeta): boolean {
  return isRegisterRowActive(row) && isRegisterRowVerified(row);
}

export const LIFECYCLE_LABELS: Record<RegisterLifecycleStatus, string> = {
  active: "Active",
  superseded: "Superseded",
  retired: "Retired",
  withdrawn: "Withdrawn",
};

/**
 * The calendar date a row should be judged "in date" on: the date of the last inspection that used it
 * once it has been retired/superseded (a thermometer replaced mid-project is not "expired" for the work
 * it covered), otherwise today.
 */
export function judgementDate(row: RegisterRowMeta, lastUsedOn: string | null | undefined, today: Date): Date {
  if (isRegisterRowActive(row) || !lastUsedOn) return today;
  const d = new Date(`${lastUsedOn.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? today : d;
}
