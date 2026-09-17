"use client";

import { useCallback, useEffect, useState } from "react";
import { getOutboxItems, isStoragePersisted, requestPersistentStorage } from "@/lib/offline/db";
import { onOutboxChanged, syncOutbox } from "@/lib/offline/sync-client";

/**
 * Real, live status — never a static "you're offline" placeholder. Reflects the actual
 * navigator.onLine state and the actual contents of the IndexedDB outbox (lib/offline/db.ts), and
 * triggers a real sync attempt on reconnect. Mounted once in the inspect layout so it's visible
 * from anywhere in the field-work flow, not just the checklist page.
 */
export function OfflineBanner() {
  // Always matches the server's render on first paint (server has no `navigator`, so it always
  // renders as if online) — reading the real navigator.onLine value happens only inside the effect
  // below, which runs post-hydration. Reading it directly in the initial state, even guarded by a
  // typeof check, still diverges from the server whenever the client is actually offline at first
  // paint, which is exactly the case this component exists to handle — that mismatch is what was
  // throwing "Hydration failed" on every load.
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // Round-table finding: the offline outbox lives in "best-effort" IndexedDB storage by default,
  // which the browser (iOS Safari most aggressively) can silently evict under storage pressure —
  // losing hours of unsynced field work with no warning. Requested proactively on every mount, not
  // only once data is already queued, since eviction risk exists the moment the origin is used, and
  // by the time there's something to protect it may already be too late to ask.
  const [storagePersisted, setStoragePersisted] = useState(true);

  const refreshCounts = useCallback(async () => {
    const items = await getOutboxItems();
    setPendingCount(items.length);
    const failing = items.filter((i) => i.lastError !== null);
    setFailedCount(failing.length);
    setLastError(failing.length > 0 ? failing[failing.length - 1].lastError : null);
  }, []);

  const attemptSync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      await syncOutbox();
    } finally {
      setSyncing(false);
      await refreshCounts();
    }
  }, [refreshCounts]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      attemptSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const unsubscribe = onOutboxChanged(() => {
      refreshCounts();
      if (navigator.onLine) attemptSync();
    });

    // Deferred a tick so the initial load (and any queued item left from a previous session) runs
    // as a reaction to mount rather than a synchronous setState-in-effect.
    const initialCheck = setTimeout(() => {
      refreshCounts();
      if (navigator.onLine) attemptSync();
      isStoragePersisted().then((already) => {
        if (already) {
          setStoragePersisted(true);
        } else {
          requestPersistentStorage().then(setStoragePersisted);
        }
      });
    }, 0);

    return () => {
      clearTimeout(initialCheck);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribe();
    };
  }, [attemptSync, refreshCounts]);

  const showStorageWarning = pendingCount > 0 && !storagePersisted;

  if (isOnline && pendingCount === 0) return null;

  return (
    <div
      className={
        "flex items-center justify-between gap-3 px-4 py-2 text-sm " +
        (failedCount > 0
          ? "bg-danger/10 text-danger"
          : isOnline
            ? "bg-info/10 text-info"
            : "bg-warning/10 text-warning")
      }
    >
      <span>
        {!isOnline && "You're offline. "}
        {syncing && "Syncing… "}
        {pendingCount > 0 && `${pendingCount} change${pendingCount === 1 ? "" : "s"} queued`}
        {pendingCount > 0 && !isOnline && " — will sync automatically when you're back online."}
        {failedCount > 0 && ` — ${failedCount} couldn't sync${lastError ? `: ${lastError}` : ""}.`}
        {showStorageWarning &&
          " — this browser did not grant protected storage for queued data; sync as soon as you're back online to avoid losing it."}
      </span>
      {isOnline && pendingCount > 0 && !syncing && (
        <button type="button" onClick={attemptSync} className="shrink-0 font-medium underline">
          Retry now
        </button>
      )}
    </div>
  );
}
