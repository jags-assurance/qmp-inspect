"use client";

// Tiny IndexedDB-backed outbox (R60: "inspectors can complete checklists, capture photos and sign
// while offline... nothing is lost offline"). No library — the surface area needed (one store,
// FIFO read, delete-by-id) doesn't justify one. Every write everywhere else in this app goes
// through a Server Action or a direct Supabase call, both of which require a live connection; this
// is the one place state survives a dropped connection until it can actually reach the server.

import { responseKey } from "./policy";
import { getLocalUserId } from "./user";

const DB_NAME = "qmp-inspect-offline";
const DB_VERSION = 1;
const STORE_NAME = "outbox";

export type OutboxKind =
  | "checklist_response"
  | "photo"
  | "complete_inspection"
  | "raise_observation"
  | "standalone_measurement"
  | "standalone_photo"
  | "standalone_signature";

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  /** Plain string fields for the target Server Action's FormData — everything except the file. */
  fields: Record<string, string>;
  /** Photo bytes, for kind "photo" only. */
  file?: Blob;
  fileName?: string;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Idempotency key sent with every replay (X-Idempotency-Key); the server uses it to make a retried item a no-op. */
  clientKey?: string;
  /**
   * pending  = waiting (or transient network/server error — retried automatically)
   * rejected = server refused it (422): stays queued for the user to Retry/Discard
   * conflict = the answer changed on the server since this one was based on it (409): review required
   * auth     = session expired; resumes after sign-in
   * foreign  = queued by a different signed-in user; never replayed under the current user (Export / Discard)
   */
  status?: "pending" | "rejected" | "conflict" | "auth" | "foreign";
  /** The user who queued this item (shared-tablet safety). Absent on items queued before this existed. */
  userId?: string;
  /** Earliest time (epoch ms) the next automatic attempt may run — exponential backoff after 5xx. */
  nextAttemptAt?: number;
  /** Server-confirmed failures so far (5xx); network failures are not counted. */
  serverFailures?: number;
  /** Server updated_at this queued answer was based on (checklist answers), for conflict detection. */
  expectedUpdatedAt?: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Queues an item for later sync. Fails silently to the caller's own catch if IndexedDB is unavailable (very old/locked-down browsers) — the caller decides what "couldn't even queue it" means for its own UI. */
export async function enqueueOutboxItem(item: Omit<OutboxItem, "id" | "createdAt" | "attempts" | "lastError">): Promise<OutboxItem> {
  if (!isBrowser()) throw new Error("Offline queue is not available in this environment.");
  const id = crypto.randomUUID();
  const userId = (await getLocalUserId()) ?? undefined;
  const full: OutboxItem = {
    ...item,
    userId,
    id,
    clientKey: id,
    status: "pending",
    expectedUpdatedAt: item.expectedUpdatedAt ?? item.fields.expected_updated_at ?? undefined,
    createdAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  try {
    await withStore("readwrite", (store) => store.put(full));
  } catch (err) {
    const name = err instanceof Error ? err.name : (err as { name?: string } | null)?.name;
    if (name === "QuotaExceededError") {
      throw new Error("This device is out of storage, so the change could not be saved offline. Free some space or reconnect.");
    }
    throw err;
  }
  return full;
}

export async function getOutboxItems(): Promise<OutboxItem[]> {
  if (!isBrowser()) return [];
  const items = await withStore<OutboxItem[]>("readonly", (store) => store.getAll());
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * True when an answer for this checklist item is still waiting in the queue. A new answer must join the
 * queue behind it instead of going straight to the server: sent online it would overtake the queued one,
 * and when that one replayed later it would be judged a conflict with the newer value.
 */
export async function hasQueuedAnswerFor(inspectionRecordId: string, checklistItemId: string): Promise<boolean> {
  if (!isBrowser()) return false;
  try {
    const items = await getOutboxItems();
    const key = `${inspectionRecordId}:${checklistItemId}`;
    return items.some((it) => responseKey(it) === key);
  } catch {
    return false;
  }
}

export async function removeOutboxItem(id: string): Promise<void> {
  if (!isBrowser()) return;
  await withStore("readwrite", (store) => store.delete(id));
}

export async function recordOutboxFailure(
  id: string,
  error: string,
  status: NonNullable<OutboxItem["status"]> = "pending"
): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const item = getRequest.result as OutboxItem | undefined;
      if (!item) return resolve();
      item.attempts += 1;
      item.lastError = error;
      item.status = status;
      const putRequest = store.put(item);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/** Puts a rejected/conflicted/auth-blocked item back to pending so the next sync tries it again. */
export async function resetOutboxItem(id: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const g = store.get(id);
    g.onsuccess = () => {
      const item = g.result as OutboxItem | undefined;
      if (!item) return resolve();
      item.status = "pending";
      item.lastError = null;
      item.serverFailures = 0;
      item.nextAttemptAt = undefined;
      const p = store.put(item);
      p.onsuccess = () => resolve();
      p.onerror = () => reject(p.error);
    };
    g.onerror = () => reject(g.error);
  });
}

/** Marks a conflicted answer as "keep mine": drops the stale expectation so it overwrites on the next sync. */
export async function forceOutboxItem(id: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const g = store.get(id);
    g.onsuccess = () => {
      const item = g.result as OutboxItem | undefined;
      if (!item) return resolve();
      item.status = "pending";
      item.lastError = null;
      item.serverFailures = 0;
      item.nextAttemptAt = undefined;
      item.expectedUpdatedAt = undefined;
      delete item.fields.expected_updated_at;
      const p = store.put(item);
      p.onsuccess = () => resolve();
      p.onerror = () => reject(p.error);
    };
    g.onerror = () => reject(g.error);
  });
}

/** Replaces fields on a queued item (used to chain the server baseline across queued answers). */
export async function patchOutboxItem(id: string, patch: (item: OutboxItem) => void): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const g = store.get(id);
    g.onsuccess = () => {
      const item = g.result as OutboxItem | undefined;
      if (!item) return resolve();
      patch(item);
      const p = store.put(item);
      p.onsuccess = () => resolve();
      p.onerror = () => reject(p.error);
    };
    g.onerror = () => reject(g.error);
  });
}

/** Records a server-confirmed failure and schedules the next attempt (backoff). */
export async function recordOutboxBackoff(id: string, error: string, failures: number, nextAttemptAt: number, status: NonNullable<OutboxItem["status"]>): Promise<void> {
  await patchOutboxItem(id, (item) => {
    item.attempts += 1;
    item.serverFailures = failures;
    item.nextAttemptAt = nextAttemptAt;
    item.lastError = error;
    item.status = status;
  });
}

/** Notes a network-level failure without spending the retry budget (offline / timeout / captive portal). */
export async function recordOutboxNetworkError(id: string, error: string): Promise<void> {
  await patchOutboxItem(id, (item) => {
    item.attempts += 1;
    item.lastError = error;
  });
}

export interface OutboxStats {
  count: number;
  /** Approximate bytes held (photo blobs plus field text). */
  bytes: number;
  oldestCreatedAt: number | null;
}

export async function getOutboxStats(): Promise<OutboxStats> {
  const items = await getOutboxItems();
  let bytes = 0;
  let oldest: number | null = null;
  for (const i of items) {
    bytes += i.file?.size ?? 0;
    for (const v of Object.values(i.fields)) bytes += v.length;
    if (oldest === null || i.createdAt < oldest) oldest = i.createdAt;
  }
  return { count: items.length, bytes, oldestCreatedAt: oldest };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Last-resort backup: serialises the whole queue (photos inline as data URLs) so a tester whose
 * storage is about to be evicted can save it to a file and hand it to support.
 */
export async function exportOutboxJson(): Promise<string> {
  const items = await getOutboxItems();
  const out = [];
  for (const i of items) {
    const { file, ...rest } = i;
    out.push({ ...rest, file: file ? await blobToDataUrl(file).catch(() => null) : null });
  }
  return JSON.stringify({ exportedAt: new Date().toISOString(), items: out }, null, 2);
}

export async function getOutboxCount(): Promise<number> {
  if (!isBrowser()) return 0;
  return withStore<number>("readonly", (store) => store.count());
}

/**
 * Round-table field-usability finding: this IndexedDB outbox is the only thing standing between an
 * inspector's hours of offline work and total data loss, but storage in "best-effort" mode (the
 * browser default) can be silently evicted under storage pressure — most aggressively by iOS
 * Safari, which can clear it after as little as 7 days of the site being unvisited, with no warning
 * to the user. `navigator.storage.persist()` asks the browser to exempt this origin from that
 * automatic eviction. Never assume it was granted — some browsers silently refuse it outside
 * specific engagement heuristics (e.g. installed-as-PWA) — always check the actual result.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isStoragePersisted(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}
