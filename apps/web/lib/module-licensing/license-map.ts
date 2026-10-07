import type { ModuleKey } from "./types";

/**
 * Pure helpers over an org's explicit licence rows (`module_key -> is_licensed`), shared by the
 * cached loader (cache.ts) and unit tests.
 *
 * FAIL OPEN, ALWAYS (see access.ts): a module is unlicensed only by an explicit `is_licensed = false`
 * row. A missing row, or a missing map (cache/DB unavailable), means licensed.
 */
export type LicenseMap = Record<string, boolean>;

export function toLicenseMap(rows: ReadonlyArray<{ module_key: string; is_licensed: boolean }> | null | undefined): LicenseMap {
  const map: LicenseMap = {};
  for (const row of rows ?? []) map[row.module_key] = row.is_licensed;
  return map;
}

export function isLicensedIn(map: LicenseMap | null | undefined, key: ModuleKey): boolean {
  if (!map) return true;
  return map[key] !== false;
}

/** Tag for revalidateTag() when an org's licences change. */
export function licenseCacheTag(organizationId: string): string {
  return `module-licenses:${organizationId}`;
}
