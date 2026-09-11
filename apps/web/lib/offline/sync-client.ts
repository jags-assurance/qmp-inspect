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

/**
 * Replays every queued item against POST /api/offline-sync, in the order it was queued (so a
 * "complete inspection" queued after its checklist responses syncs after them, matching what
 * would have happened online). Continues past a single item's failure — one bad item shouldn't
 * block everything queued behind it — and leaves failed items in the outbox with the real error
 * recorded, never silently dropped (R60: "nothing is lost offline").
 */
export async function syncOutbox(): Promise<{ synced: number; failed: number }> {
  const items = await getOutboxItems();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const response = await fetch("/api/offline-sync", { method: "POST", body: buildFormData(item) });
      const body = (await response.json().catch(() => ({ ok: false, error: "Invalid server response." }))) as {
        ok: boolean;
        error?: string;
      };
      if (response.ok && body.ok) {
        await removeOutboxItem(item.id);
        synced++;
      } else {
        await recordOutboxFailure(item.id, body.error ?? `Server rejected the request (${response.status}).`);
        failed++;
      }
    } catch (err) {
      // A network error mid-sync (connection dropped again) — stop here rather than burning
      // through the rest of the queue against a connection that's already gone; the next
      // online/offline transition or manual retry will pick up where this left off.
      await recordOutboxFailure(item.id, err instanceof Error ? err.message : "Network error.");
      failed++;
      break;
    }
  }

  notifyOutboxChanged();
  return { synced, failed };
}
