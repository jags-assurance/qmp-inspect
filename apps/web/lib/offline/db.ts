"use client";

// Tiny IndexedDB-backed outbox (R60: "inspectors can complete checklists, capture photos and sign
// while offline... nothing is lost offline"). No library — the surface area needed (one store,
// FIFO read, delete-by-id) doesn't justify one. Every write everywhere else in this app goes
// through a Server Action or a direct Supabase call, both of which require a live connection; this
// is the one place state survives a dropped connection until it can actually reach the server.

const DB_NAME = "qmp-inspect-offline";
const DB_VERSION = 1;
const STORE_NAME = "outbox";

export type OutboxKind = "checklist_response" | "photo" | "complete_inspection";

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
  const full: OutboxItem = { ...item, id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0, lastError: null };
  await withStore("readwrite", (store) => store.put(full));
  return full;
}

export async function getOutboxItems(): Promise<OutboxItem[]> {
  if (!isBrowser()) return [];
  const items = await withStore<OutboxItem[]>("readonly", (store) => store.getAll());
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeOutboxItem(id: string): Promise<void> {
  if (!isBrowser()) return;
  await withStore("readwrite", (store) => store.delete(id));
}

export async function recordOutboxFailure(id: string, error: string): Promise<void> {
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
      const putRequest = store.put(item);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
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
