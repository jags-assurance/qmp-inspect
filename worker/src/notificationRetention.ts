import { supabase } from "./supabase";
import {
  NOTIFICATION_RETENTION_BATCH_SIZE,
  isNotificationRetentionEnabled,
  notificationRetentionCutoffs,
  shouldRunNotificationRetention,
} from "./notificationRetentionPolicy";

// notifications is accessed untyped so this sweep stays independent of the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
const db = supabase as any;

const MAX_BATCHES_PER_RUN = 200;
let lastRunAt: number | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- query builder filter callback
async function deleteBatches(apply: (q: any) => any): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const { data, error } = await apply(db.from("notifications").select("id")).limit(NOTIFICATION_RETENTION_BATCH_SIZE);
    if (error) throw new Error(error.message);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) break;
    const { error: delError } = await db.from("notifications").delete().in("id", ids);
    if (delError) throw new Error(delError.message);
    deleted += ids.length;
    if (ids.length < NOTIFICATION_RETENTION_BATCH_SIZE) break;
  }
  return deleted;
}

/**
 * Deletes READ notifications older than 90 days and any notification older than 365 days, in batches of
 * 500. Off unless NOTIFICATION_RETENTION_ENABLED=true; at most once a day. The caller holds a lease so only
 * one replica runs it. Returns the number of rows deleted.
 */
export async function runNotificationRetentionSweep(now: number = Date.now()): Promise<number> {
  if (!isNotificationRetentionEnabled(process.env)) return 0;
  if (!shouldRunNotificationRetention(lastRunAt, now)) return 0;
  lastRunAt = now;
  const { readBeforeIso, anyBeforeIso } = notificationRetentionCutoffs(now);
  const readDeleted = await deleteBatches((q) => q.eq("is_read", true).lt("created_at", readBeforeIso));
  const oldDeleted = await deleteBatches((q) => q.lt("created_at", anyBeforeIso));
  const total = readDeleted + oldDeleted;
  if (total > 0) console.log(`[worker] Notification retention deleted ${total} notification(s).`);
  return total;
}
