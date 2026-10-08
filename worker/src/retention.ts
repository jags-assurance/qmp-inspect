import { supabase } from "./supabase";
import { getOrgAdminUserIds, notify } from "./automation";
import {
  isValidRetentionYears,
  retentionCreatedCutoffIso,
  selectDocumentsToFlag,
  shouldRunRetentionSweep,
  type FlagCandidate,
} from "./retentionPolicy";

// org_retention_settings / vault_retention_flags aren't in the generated Database type (same documented
// escape hatch as automation.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
const db = supabase as any;

/** Documents examined per organisation per run; the rest are picked up by the next run (flagged ones drop out). */
const PAGE_SIZE = 500;
const MAX_PAGES_PER_ORG = 20;

interface CandidateRow extends FlagCandidate {
  project_id: string;
}

let lastRunAt: number | null = null;

/**
 * S6-18: flags vault documents that are past their organisation's retention period. It ONLY inserts rows
 * into vault_retention_flags - it never deletes, hides, moves or edits a document - and tells the
 * organisation's admins how many are waiting for a decision. Runs at most once a day. Needs migration
 * 20261112000103; until it is applied the first query errors and the sweep quietly does nothing.
 * Returns the number of newly flagged documents.
 */
export async function runRetentionSweep(now: number = Date.now()): Promise<number> {
  if (!shouldRunRetentionSweep(lastRunAt, now)) return 0;

  const { data: settings, error } = await db
    .from("org_retention_settings")
    .select("organization_id, retention_years")
    .eq("enabled", true);
  if (error) return 0;
  lastRunAt = now;

  let total = 0;
  for (const setting of (settings ?? []) as { organization_id: string; retention_years: number }[]) {
    if (!isValidRetentionYears(setting.retention_years)) continue;
    try {
      const flagged = await flagOrganisation(setting.organization_id, setting.retention_years, now);
      total += flagged;
      if (flagged > 0) {
        const admins = await getOrgAdminUserIds(setting.organization_id);
        const title = `${flagged} document${flagged === 1 ? " is" : "s are"} past the retention period`;
        const body = `${flagged} vault document${flagged === 1 ? " has" : "s have"} passed the ${setting.retention_years}-year retention period and need a review decision. Nothing has been deleted or changed.`;
        for (const id of admins) await notify(setting.organization_id, null, id, title, body, "/inspect/settings?section=retention");
      }
    } catch (err) {
      console.error(`[worker] retention sweep failed for organisation ${setting.organization_id}:`, err instanceof Error ? err.message : err);
    }
  }
  if (total > 0) console.log(`[worker] Retention sweep flagged ${total} document(s) for review.`);
  return total;
}

async function flagOrganisation(organizationId: string, years: number, now: number): Promise<number> {
  const cutoff = retentionCreatedCutoffIso(now, years);
  let flagged = 0;
  for (let page = 0; page < MAX_PAGES_PER_ORG; page++) {
    const { data, error } = await db.rpc("retention_flag_candidates", {
      p_organization_id: organizationId,
      p_created_before: cutoff,
      p_limit: PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    const candidates = (data ?? []) as CandidateRow[];
    if (candidates.length === 0) break;

    const projectByDoc = new Map(candidates.map((c) => [c.id, c.project_id]));
    const toFlag = selectDocumentsToFlag(candidates, years, now);
    if (toFlag.length > 0) {
      const { error: insertError } = await db.from("vault_retention_flags").upsert(
        toFlag.map((f) => ({ ...f, organization_id: organizationId, project_id: projectByDoc.get(f.document_id) })),
        { onConflict: "document_id", ignoreDuplicates: true }
      );
      if (insertError) throw new Error(insertError.message);
      flagged += toFlag.length;
    }
    // Nothing was flaggable this page (cannot happen for rows the cutoff returned, but never loop forever).
    if (toFlag.length === 0 || candidates.length < PAGE_SIZE) break;
  }
  return flagged;
}
