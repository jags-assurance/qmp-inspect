import { supabase } from "./supabase";
import { getOrgAdminUserIds, notify } from "./automation";
import {
  countByOrganisation,
  orphanCutoffIso,
  ORPHAN_MAX_PAGES,
  ORPHAN_PAGE_SIZE,
  shouldRunOrphanSweep,
  type OrphanCandidate,
} from "./orphanPhotoPolicy";

// orphan_photo_flags / orphan_photo_candidates aren't in the generated Database type (same documented
// escape hatch as retention.ts and automation.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
const db = supabase as any;

interface CandidateRow extends OrphanCandidate {
  project_id: string;
  inspection_record_id: string;
  object_created_at: string | null;
}

let lastRunAt: number | null = null;

/**
 * S4-19: flags inspection photos that exist in Storage but have no inspection_photos row. It ONLY inserts
 * rows into orphan_photo_flags and tells the organisation's admins how many are waiting for review; it
 * never deletes, moves or edits a file. Runs at most once a day. Needs migration 20261113000400; until it
 * is applied the first RPC errors and the sweep quietly does nothing. Returns the number newly flagged.
 */
export async function runOrphanPhotoSweep(now: number = Date.now()): Promise<number> {
  if (!shouldRunOrphanSweep(lastRunAt, now)) return 0;
  const cutoff = orphanCutoffIso(now);
  let total = 0;
  const perOrg = new Map<string, number>();

  for (let page = 0; page < ORPHAN_MAX_PAGES; page++) {
    const { data, error } = await db.rpc("orphan_photo_candidates", { p_created_before: cutoff, p_limit: ORPHAN_PAGE_SIZE });
    if (error) {
      if (page === 0) return 0; // migration not applied (or transient): try again next cycle
      throw new Error(error.message);
    }
    const candidates = (data ?? []) as CandidateRow[];
    if (candidates.length === 0) break;
    lastRunAt = now;

    const { error: insertError } = await db.from("orphan_photo_flags").upsert(
      candidates.map((c) => ({
        storage_path: c.storage_path,
        project_id: c.project_id,
        organization_id: c.organization_id,
        inspection_record_id: c.inspection_record_id,
        size_bytes: c.size_bytes,
        object_created_at: c.object_created_at,
      })),
      { onConflict: "storage_path", ignoreDuplicates: true }
    );
    if (insertError) throw new Error(insertError.message);
    total += candidates.length;
    for (const [org, n] of countByOrganisation(candidates)) perOrg.set(org, (perOrg.get(org) ?? 0) + n);
    if (candidates.length < ORPHAN_PAGE_SIZE) break;
  }
  if (lastRunAt === null) lastRunAt = now;

  for (const [orgId, n] of perOrg) {
    try {
      const admins = await getOrgAdminUserIds(orgId);
      const title = `${n} orphaned photo${n === 1 ? "" : "s"} found in storage`;
      const body = `${n} uploaded file${n === 1 ? " has" : "s have"} no matching inspection photo record. Nothing has been deleted; an Admin can review them.`;
      for (const id of admins) await notify(orgId, null, id, title, body, "/inspect");
    } catch (err) {
      console.error(`[worker] orphan photo notice failed for organisation ${orgId}:`, err instanceof Error ? err.message : err);
    }
  }
  if (total > 0) console.log(`[worker] Orphan photo sweep flagged ${total} file(s) for review.`);
  return total;
}
