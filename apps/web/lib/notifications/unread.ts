// The bell shows the latest `limit` notifications plus a TRUE unread total. When fewer than `limit`
// rows came back, that list IS every notification the user has, so the unread count is just a count of
// the list and the extra head-count query can be skipped.

export function needsUnreadCountQuery(listed: ReadonlyArray<unknown>, limit: number): boolean {
  return listed.length >= limit;
}

export function unreadInList(listed: ReadonlyArray<{ is_read: boolean }>): number {
  let n = 0;
  for (const r of listed) if (!r.is_read) n += 1;
  return n;
}
