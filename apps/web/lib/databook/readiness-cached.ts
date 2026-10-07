import { cache } from "react";
import { computeDataBookReadiness, type DataBookReadiness } from "./readiness";
import { TtlMemo } from "./readiness-memo";

/**
 * S7-25: readiness for DISPLAY (the Data Book page and the KPI tab), with a short memo.
 *
 * Keyed per viewer AND project: readiness is computed through the viewer's RLS-scoped client, so
 * what one user may see of a project is not necessarily what another may, and a shared entry would
 * leak that difference. 15 seconds is short enough that a closed punch item or signed hold shows up
 * on the next refresh, long enough to collapse the realtime refresh burst and tab flips that used to
 * each pay for a full project scan.
 *
 * NEVER use this for the compile / issue-handover gates (lib/databook/actions.ts,
 * lib/handover/actions.ts): those call computeDataBookReadiness() directly so the gate always sees
 * the live state. After a state-changing action in this process, call
 * invalidateDataBookReadiness(projectId) so the same user is not shown a pre-change number.
 */
export const READINESS_MEMO_TTL_MS = 15_000;

const memo = new TtlMemo<DataBookReadiness>(READINESS_MEMO_TTL_MS);

const keyFor = (userId: string, projectId: string) => `${projectId}:${userId}`;

// React cache() first, so even with the memo disabled one render never computes twice.
const perRequest = cache((userId: string, projectId: string) =>
  memo.get(keyFor(userId, projectId), () => computeDataBookReadiness(projectId))
);

export function getDataBookReadiness(userId: string, projectId: string): Promise<DataBookReadiness> {
  return perRequest(userId, projectId);
}

/** Forget every viewer's memoised readiness for a project (call after an action that changes it). */
export function invalidateDataBookReadiness(projectId: string): void {
  memo.invalidate(`${projectId}:`);
}
