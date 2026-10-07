"use client";

import { getOutboxItems, removeOutboxItem, recordOutboxFailure, type OutboxItem } from "./db";

const QUEUE_CHANGED_EVENT = "qmp-offline-queue-changed";

/** Producers (ResponseRow, PhotoUpload, CompleteInspectionForm) call this after enqueueing an item
 *  so OfflineBanner refreshes its count and, if online, attempts an immediate sync rather than
 *  waiting for the next online/offline transition. */
export function notifyOutboxChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

export function onOutboxChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(QUEUE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(QUEUE_CHANGED_EVENT, handler);
}

function buildFormData(item: OutboxItem): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(item.fields)) formData.set(key, value);
  if (item.file) formData.set("file", item.file, item.fileName ?? "photo.jpg");
  return formData;
}

/** After this many failed attempts a transiently-failing item is marked rejected so it stops blocking the queue. */
const MAX_ATTEMPTS = 5;

let syncInFlight: Promise<{ synced: number; failed: number }> | null = null;

/**
 * Replays queued items against POST /api/offline-sync in queue order. Only "pending" items are
 * attempted automatically; rejected/conflict/auth items wait for the user (Retry / Keep mine /
 * Discard) so a permanently-bad item is not hammered forever. If an item for an inspection is
 * blocked, later items for the SAME inspection are held back (a "complete inspection" must never
 * run before the answers queued ahead of it). Network/5xx errors are transient: the item stays
 * pending and the run stops. A single run at a time (concurrent triggers share the same promise).
 */
export function syncOutbox(): Promise<{ synced: number; failed: number }> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSync(): Promise<{ synced: number; failed: number }> {
  const items = await getOutboxItems();
  let synced = 0;
  let failed = 0;
  const blockedInspections = new Set<string>();

  for (const item of items) {
    const group = item.fields.inspection_record_id ?? "";
    if (group && blockedInspections.has(group)) continue;
    if (item.status && item.status !== "pending") {
      if (group) blockedInspections.add(group);
      continue;
    }
    try {
      const response = await fetch("/api/offline-sync", {
        method: "POST",
        body: buildFormData(item),
        headers: { "X-Idempotency-Key": item.clientKey ?? item.id },
        credentials: "same-origin",
        redirect: "manual",
      });
      // Expired session: middleware redirects (opaque redirect) or API answers 401/403.
      if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403) {
        await recordOutboxFailure(item.id, "Your session expired. Sign in again to finish syncing — nothing has been lost.", "auth");
        failed++;
        break;
      }
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; conflict?: boolean } | null;
      if (response.ok && body?.ok) {
        await removeOutboxItem(item.id);
        synced++;
      } else if (response.status === 409 || body?.conflict) {
        await recordOutboxFailure(
          item.id,
          body?.error ?? "This answer was changed by someone else after you recorded it offline.",
          "conflict"
        );
        if (group) blockedInspections.add(group);
        failed++;
      } else if (response.status === 422 || response.status === 400) {
        await recordOutboxFailure(item.id, body?.error ?? `The server rejected this change (${response.status}).`, "rejected");
        if (group) blockedInspections.add(group);
        failed++;
      } else {
        // 5xx / unparseable: transient. After MAX_ATTEMPTS the item is rejected (user must Retry/Discard)
        // and later groups continue; before that it stays pending and this inspection's later items wait.
        const exhausted = (item.attempts ?? 0) + 1 >= MAX_ATTEMPTS;
        await recordOutboxFailure(
          item.id,
          exhausted ? "The server keeps failing to process this item. Retry or discard it." : "Server error. Will retry.",
          exhausted ? "rejected" : "pending"
        );
        failed++;
        if (group) {
          blockedInspections.add(group);
        } else if (!exhausted) {
          break;
        }
      }
    } catch (err) {
      const exhausted = (item.attempts ?? 0) + 1 >= MAX_ATTEMPTS;
      await recordOutboxFailure(
        item.id,
        exhausted ? "This item could not be sent after several attempts. Retry or discard it." : "Network error. Will retry.",
        exhausted ? "rejected" : "pending"
      );
      failed++;
      if (!exhausted) break;
      if (group) blockedInspections.add(group);
    }
  }

  notifyOutboxChanged();
  return { synced, failed };
}
