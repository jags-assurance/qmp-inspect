// Groups stale register-status writes so refreshing a project's registers is one UPDATE per distinct
// new status (chunked) instead of one UPDATE per row.

export interface StatusUpdate {
  id: string;
  next: string;
}

/** New status -> row ids, each list split into chunks of at most `chunkSize` ids. */
export function groupStatusUpdates(updates: ReadonlyArray<StatusUpdate>, chunkSize = 100): { status: string; ids: string[] }[] {
  const byStatus = new Map<string, string[]>();
  for (const u of updates) {
    const list = byStatus.get(u.next) ?? [];
    list.push(u.id);
    byStatus.set(u.next, list);
  }
  const out: { status: string; ids: string[] }[] = [];
  for (const [status, ids] of byStatus) {
    for (let i = 0; i < ids.length; i += chunkSize) out.push({ status, ids: ids.slice(i, i + chunkSize) });
  }
  return out;
}
