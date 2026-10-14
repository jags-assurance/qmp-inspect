"use client";

import {
  getOutboxItems,
  patchOutboxItem,
  recordOutboxBackoff,
  recordOutboxFailure,
  recordOutboxNetworkError,
  removeOutboxItem,
  type OutboxItem,
} from "./db";
import { MAX_SERVER_FAILURES, ORIGIN_REJECTED_MESSAGE, backoffMs, classifyHttpFailure, isOriginRejection, isItemHeld, isPermanentFailure, isWitnessNoticeError, itemGroupKey, laterAnswersToRebase, mayReplayItem, recordHold, responseKey, WITNESS_NOTICE_MESSAGE, type GroupHolds } from "./policy";
import { getLocalUserId } from "./user";

const QUEUE_CHANGED_EVENT = "qmp-offline-queue-changed";
/** Fired after a queued checklist answer syncs, so the on-screen row can adopt the new server baseline
 *  (otherwise its next online save would be judged a conflict with the write the queue just made). */
export const RESPONSE_SYNCED_EVENT = "qmp-response-synced";
export interface ResponseSyncedDetail {
  inspectionRecordId: string;
  checklistItemId: string;
  updatedAt: string;
}

/** Producers (ResponseRow, PhotoUpload, CompleteInspectionForm) call this after enqueueing an item
 *  so OfflineBanner refreshes its count and, if online, attempts an immediate sync rather than
 *  waiting for the next online/offline transition. */
export function notifyOutboxChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
    void registerBackgroundSync();
  }
}

/** Tag the service worker listens for (public/sw.js). */
export const BACKGROUND_SYNC_TAG = "qmp-sync";

/**
 * Asks the browser to wake the service worker when connectivity returns (Background Sync API, Chromium
 * only; absent on Safari/iOS and Firefox, where this is a silent no-op). The worker does NOT replay the
 * queue itself: it messages an open page, which runs the normal syncOutbox() (one replay path, so the
 * ownership / ordering / hold rules and server idempotency keys apply unchanged). Best-effort only.
 */
export async function registerBackgroundSync(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sync = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync;
    if (sync) await sync.register(BACKGROUND_SYNC_TAG);
  } catch {
    // Unsupported or denied: the page-level triggers (online, visibility, 60s timer) still apply.
  }
}

export function onOutboxChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(QUEUE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(QUEUE_CHANGED_EVENT, handler);
}

/** The multipart body replayed to POST /api/offline-sync. The route dispatches on `kind`, so it must travel with the fields. */
export function buildFormData(item: OutboxItem): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(item.fields)) formData.set(key, value);
  formData.set("kind", item.kind);
  // Real capture time (the item was recorded now-ish on the device, replayed hours later): the
  // server uses it for signed_at / photo timestamps instead of the sync time.
  formData.set("captured_at", new Date(item.createdAt).toISOString());
  if (item.file) formData.set("file", item.file, item.fileName ?? "photo.jpg");
  return formData;
}

const REQUEST_TIMEOUT_MS = 90_000;

let syncInFlight: Promise<{ synced: number; failed: number }> | null = null;

/**
 * Replays queued items against POST /api/offline-sync in queue order. Only "pending" items are
 * attempted automatically; rejected/conflict/auth/foreign items wait for the user (Retry / Keep mine
 * / Discard) so a permanently-bad item is not hammered forever. If an item for an inspection is
 * blocked, later items for the SAME inspection are held back (a "complete inspection" must never
 * run before the answers queued ahead of it).
 *
 * Retry budget: only server-confirmed failures (5xx from our own handler) count towards
 * MAX_SERVER_FAILURES, each followed by exponential backoff. Network errors, timeouts and gateway or
 * captive-portal responses never spend the budget, so hours on edge-of-coverage signal cannot flip
 * good items to "rejected". A platform 413 (photo too large for the host) can never succeed and is
 * rejected straight away with a clear message.
 *
 * Shared tablets: an item is replayed only by the user who queued it. A single run at a time
 * (concurrent triggers share the same promise).
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
  const currentUserId = await getLocalUserId();
  let synced = 0;
  let failed = 0;
  const holds: GroupHolds = new Map();

  for (const item of items) {
    const group = itemGroupKey(item);
    if (isItemHeld(holds, group, item)) continue;
    if (item.status && item.status !== "pending") {
      recordHold(holds, group, item, isPermanentFailure(item.status));
      continue;
    }

    if (!mayReplayItem(item.userId, currentUserId)) {
      // Queued by someone else (or we cannot tell who is signed in): never replay under this session.
      if (currentUserId) {
        await recordOutboxFailure(
          item.id,
          "Queued by a different user on this device. Sign in as that user to sync it, or export/discard it.",
          "foreign"
        );
      }
      recordHold(holds, group, item, false);
      continue;
    }

    if (item.nextAttemptAt && item.nextAttemptAt > Date.now()) {
      recordHold(holds, group, item, false);
      continue;
    }

    const headers: Record<string, string> = { "X-Idempotency-Key": item.clientKey ?? item.id };
    if (item.userId) headers["X-Queued-User"] = item.userId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/offline-sync", {
        method: "POST",
        body: buildFormData(item),
        headers,
        credentials: "same-origin",
        redirect: "manual",
        signal: controller.signal,
      });
      clearTimeout(timer);
      // Expired session: middleware redirects (opaque redirect) or API answers 401/403.
      if (response.type === "opaqueredirect") {
        await recordOutboxFailure(item.id, "Your session expired. Sign in again to finish syncing — nothing has been lost.", "auth");
        failed++;
        break;
      }
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        conflict?: boolean;
        wrongUser?: boolean;
        originRejected?: boolean;
        updatedAt?: string;
      } | null;
      // E-10: the origin check also answers 403, but the session is fine — say so, and stop (every
      // later item would be refused the same way). The item stays queued for the user to Retry.
      if (isOriginRejection(response.status, body)) {
        await recordOutboxFailure(item.id, ORIGIN_REJECTED_MESSAGE, "rejected");
        failed++;
        break;
      }
      if (response.status === 401 || response.status === 403) {
        await recordOutboxFailure(item.id, "Your session expired. Sign in again to finish syncing — nothing has been lost.", "auth");
        failed++;
        break;
      }
      if (response.ok && body?.ok) {
        // Chain the server baseline FIRST, then drop the synced item. Later queued answers to the same
        // item were based on the value this one just replaced, so they must expect the NEW updated_at
        // (otherwise the second of two offline edits to one item would 409 and block completion).
        // Doing this before the removal means a tab closed half-way leaves this item queued: its replay
        // is recognised as already applied and the chain is redone, never a stale baseline on its own.
        if (body.updatedAt) {
          for (const later of laterAnswersToRebase(items, item)) {
            later.fields.expected_updated_at = body.updatedAt;
            later.expectedUpdatedAt = body.updatedAt;
            await patchOutboxItem(later.id, (stored) => {
              stored.fields.expected_updated_at = body.updatedAt as string;
              stored.expectedUpdatedAt = body.updatedAt;
            });
          }
        }
        await removeOutboxItem(item.id);
        synced++;
        if (body.updatedAt && responseKey(item) && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent<ResponseSyncedDetail>(RESPONSE_SYNCED_EVENT, {
              detail: {
                inspectionRecordId: item.fields.inspection_record_id,
                checklistItemId: item.fields.checklist_item_id,
                updatedAt: body.updatedAt,
              },
            })
          );
        }
        continue;
      }
      if (body?.wrongUser) {
        await recordOutboxFailure(item.id, body.error ?? "Queued by a different user on this device.", "foreign");
        recordHold(holds, group, item, false);
        failed++;
        continue;
      }
      const klass = body?.conflict ? "conflict" : classifyHttpFailure(response.status, body !== null);
      if (klass === "conflict") {
        await recordOutboxFailure(
          item.id,
          body?.error ?? "This answer was changed by someone else after you recorded it offline.",
          "conflict"
        );
        recordHold(holds, group, item, true);
        failed++;
      } else if (klass === "too_large") {
        await recordOutboxFailure(
          item.id,
          "This photo is too large to upload from the queue. Discard it and take it again (it will be compressed).",
          "rejected"
        );
        recordHold(holds, group, item, true);
        failed++;
      } else if (klass === "rejected") {
        const message =
          item.kind === "complete_inspection" && isWitnessNoticeError(body?.error)
            ? WITNESS_NOTICE_MESSAGE
            : (body?.error ?? `The server rejected this change (${response.status}).`);
        await recordOutboxFailure(item.id, message, "rejected");
        recordHold(holds, group, item, true);
        failed++;
      } else if (klass === "server") {
        // Our own handler failed (5xx): spend one unit of the budget and back off.
        const failures = (item.serverFailures ?? 0) + 1;
        const exhausted = failures >= MAX_SERVER_FAILURES;
        await recordOutboxBackoff(
          item.id,
          exhausted ? "The server keeps failing to process this item. Retry or discard it." : "Server error. Will retry.",
          failures,
          Date.now() + backoffMs(failures),
          exhausted ? "rejected" : "pending"
        );
        failed++;
        recordHold(holds, group, item, exhausted);
      } else {
        // Gateway / captive portal / unparseable: not a server verdict, so the budget is untouched.
        await recordOutboxNetworkError(item.id, "No usable answer from the server. Will retry.");
        failed++;
        break;
      }
    } catch {
      clearTimeout(timer);
      await recordOutboxNetworkError(item.id, "Network error. Will retry.");
      failed++;
      break;
    }
  }

  notifyOutboxChanged();
  return { synced, failed };
}
