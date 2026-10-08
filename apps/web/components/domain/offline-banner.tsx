"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  exportOutboxJson,
  forceOutboxItem,
  getOutboxItems,
  getOutboxStats,
  isStoragePersisted,
  removeOutboxItem,
  requestPersistentStorage,
  resetOutboxItem,
  type OutboxItem,
} from "@/lib/offline/db";
import { notifyOutboxChanged, onOutboxChanged, syncOutbox } from "@/lib/offline/sync-client";
import { getLocalUserId } from "@/lib/offline/user";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { STALE_QUEUE_DAYS, formatQueueAge, isStaleItem, queueAgeDays } from "@/lib/offline/policy";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND_LABEL: Record<OutboxItem["kind"], string> = {
  checklist_response: "Checklist answer",
  photo: "Photo",
  complete_inspection: "Inspection completion",
  raise_observation: "Observation",
  standalone_measurement: "Measurement",
  standalone_photo: "Assignment photo",
  standalone_signature: "Assignment signature",
  start_inspection: "Start inspection",
  link_item_document: "Linked document",
};

function describeItem(item: OutboxItem): string {
  const base = KIND_LABEL[item.kind];
  if (item.kind === "checklist_response" && item.fields.result) {
    const comment = item.fields.comment ? `: ${item.fields.comment.slice(0, 40)}` : "";
    return `${base} (${item.fields.result.toUpperCase()}${comment})`;
  }
  if (item.fileName) return `${base} ${item.fileName}`;
  return base;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Real, live status: online/offline, syncing, n queued, n needing review. Reflects the actual
 * navigator.onLine state and the contents of the IndexedDB outbox (lib/offline/db.ts). Sync is
 * triggered on mount, on the online event, when the tab becomes visible, every 60s, when an item is
 * queued, and manually via "Sync now". Items the server rejected or that conflict with a newer
 * server answer are listed with Retry / Keep mine / Discard and the reason. Mounted once in the
 * app shell. Also hosts the PWA install prompt when idle.
 */
export function OfflineBanner() {
  const { ask, dialog } = useConfirm();
  // Matches the server render on first paint (no `navigator` there); real value is read in effects.
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [reviewItems, setReviewItems] = useState<OutboxItem[]>([]);
  const [allItems, setAllItems] = useState<OutboxItem[]>([]);
  const [authBlocked, setAuthBlocked] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  // The outbox lives in best-effort IndexedDB storage unless persistence is granted (iOS Safari can
  // evict it silently), so persistence is requested on every mount.
  const [storagePersisted, setStoragePersisted] = useState(true);
  const [waitingSw, setWaitingSw] = useState<ServiceWorker | null>(null);
  const [queueBytes, setQueueBytes] = useState(0);
  const [oldestAgeDays, setOldestAgeDays] = useState(0);
  const [staleCount, setStaleCount] = useState(0);
  const pathname = usePathname();

  // Tell the service worker who is signed in (its offline page cache is per user and is wiped for any
  // other user) and ask it to keep a copy of the field page that is open right now, so a reload or an
  // app relaunch without signal still opens it with the queued-answers UI.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    (async () => {
      try {
        const [userId, reg] = await Promise.all([getLocalUserId(), navigator.serviceWorker.ready]);
        if (cancelled || !userId || !reg.active) return;
        reg.active.postMessage({ type: "REGISTER_USER", userId });
        reg.active.postMessage({ type: "CACHE_PAGES", userId, urls: [window.location.pathname + window.location.search] });
      } catch {
        // Offline caching is a convenience only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg || cancelled) return;
        if (reg.waiting && navigator.serviceWorker.controller) setWaitingSw(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) setWaitingSw(installing);
          });
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // A new worker only takes over when the user asks, and never while queued work could be lost or
  // an unsent form could be wiped: reloading replaces the page, so the user confirms it first.
  const applyUpdate = useCallback(async () => {
    if (!waitingSw) return;
    let queued = 0;
    try {
      queued = (await getOutboxItems()).length;
    } catch {
      // unknown: treat as idle
    }
    const message =
      queued > 0
        ? `${queued} change${queued === 1 ? " is" : "s are"} still queued. They are kept on this device, but any form you have not saved will be lost. Reload now?`
        : "Reloading updates the app. Any form you have not saved will be lost. Reload now?";
    const ok = await ask({ title: "Reload to update?", message, confirmLabel: "Reload now" });
    if (ok === null) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waitingSw.postMessage({ type: "SKIP_WAITING" });
  }, [waitingSw, ask]);

  const updateBar = waitingSw ? (
    <div className="flex items-center justify-between gap-3 bg-info/10 px-4 py-2 text-sm text-info" role="status">
      <span>Update available</span>
      <button type="button" className="font-medium underline" onClick={applyUpdate}>
        Reload
      </button>
    </div>
  ) : null;

  const refreshCounts = useCallback(async () => {
    try {
      const items = await getOutboxItems();
      setPendingCount(items.length);
      setAllItems(items);
      const failing = items.filter((i) => i.status === "rejected" || i.status === "conflict" || i.status === "auth" || i.status === "foreign");
      setReviewItems(failing);
      setAuthBlocked(failing.some((i) => i.status === "auth"));
      setFailedCount(failing.length);
      setLastError(failing.length > 0 ? failing[failing.length - 1].lastError : null);
      const stats = await getOutboxStats();
      setQueueBytes(stats.bytes);
      setOldestAgeDays(stats.oldestCreatedAt ? queueAgeDays(stats.oldestCreatedAt) : 0);
      setStaleCount(items.filter((i) => isStaleItem(i.createdAt)).length);
    } catch {
      // IndexedDB unavailable: nothing to show.
    }
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

  const exportQueue = useCallback(async () => {
    try {
      const json = await exportOutboxJson();
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `qmp-offline-queue-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      void ask({ title: "Export failed", message: "Could not export the queue from this browser.", confirmLabel: "OK", cancelLabel: "Close" });
    }
  }, [ask]);

  const act = useCallback(async (fn: (id: string) => Promise<void>, id: string) => {
    await fn(id);
    notifyOutboxChanged();
  }, []);

  useEffect(() => {
    const onInstall = (e: Event) => {
      e.preventDefault();
      try {
        if (localStorage.getItem("qmp-install-dismissed")) return;
      } catch {
        // storage blocked: still offer the prompt
      }
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setIsOnline(navigator.onLine);
        if (navigator.onLine) attemptSync();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => {
      setIsOnline(navigator.onLine);
      if (navigator.onLine) attemptSync();
    }, 60_000);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstall);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [attemptSync]);

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

    const initialCheck = setTimeout(() => {
      setIsOnline(navigator.onLine);
      refreshCounts();
      if (navigator.onLine) attemptSync();
      isStoragePersisted().then((already) => {
        if (already) setStoragePersisted(true);
        else requestPersistentStorage().then(setStoragePersisted);
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

  if (isOnline && pendingCount === 0) {
    if (!installEvent) return <>{dialog}{updateBar}</>;
    return (
      <>
      {dialog}
      {updateBar}
      <div className="flex items-center justify-between gap-3 bg-info/10 px-4 py-2 text-sm text-info">
        <span>Install QMP Inspect on this device for faster access in the field.</span>
        <span className="flex shrink-0 gap-3">
          <button
            type="button"
            className="font-medium underline"
            onClick={async () => {
              await installEvent.prompt();
              await installEvent.userChoice.catch(() => null);
              setInstallEvent(null);
            }}
          >
            Install
          </button>
          <button
            type="button"
            className="underline"
            onClick={() => {
              try {
                localStorage.setItem("qmp-install-dismissed", "1");
              } catch {
                // ignore
              }
              setInstallEvent(null);
            }}
          >
            Not now
          </button>
        </span>
      </div>
      </>
    );
  }

  return (
    <div>
      {dialog}
      {updateBar}
      <div
        role="status"
        aria-live="polite"
        className={
          "flex items-center justify-between gap-3 px-4 py-2 text-sm " +
          (failedCount > 0 ? "bg-danger/10 text-danger" : isOnline ? "bg-info/10 text-info" : "bg-warning/10 text-warning")
        }
      >
        <span>
          {!isOnline && "You're offline. "}
          {syncing && "Syncing… "}
          {pendingCount > 0 && `${pendingCount} change${pendingCount === 1 ? "" : "s"} queued`}
          {pendingCount > 0 && ` (${formatBytes(queueBytes)}${oldestAgeDays > 0 ? `, oldest ${oldestAgeDays} day${oldestAgeDays === 1 ? "" : "s"} old` : ""})`}
          {pendingCount > 0 && !isOnline && " — will sync automatically when you're back online."}
          {staleCount > 0 &&
            ` — ${staleCount} waiting ${STALE_QUEUE_DAYS}+ days: connect and sync soon, this browser can clear idle storage.`}
          {failedCount > 0 && ` — ${failedCount} need${failedCount === 1 ? "s" : ""} review${authBlocked && lastError ? `: ${lastError}` : ""}.`}
          {showStorageWarning &&
            " — this browser did not grant protected storage for queued data; sync as soon as you're back online to avoid losing it."}
        </span>
        <span className="flex shrink-0 gap-3">
          {isOnline && pendingCount > 0 && !syncing && (
            <button type="button" onClick={attemptSync} className="font-medium underline">
              Sync now
            </button>
          )}
          {pendingCount > 0 && (staleCount > 0 || failedCount > 0 || !storagePersisted) && (
            <button type="button" onClick={exportQueue} className="underline">
              Export queue
            </button>
          )}
          {authBlocked && (
            <a href="/login" className="font-medium underline">
              Sign in
            </a>
          )}
        </span>
      </div>
      {pendingCount > 0 && (
        <details className="border-b border-border bg-surface text-sm">
          <summary className="cursor-pointer px-4 py-2 text-muted">View everything in the queue ({pendingCount})</summary>
          <ul className="divide-y divide-border">
            {allItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5">
                <span>
                  {describeItem(item)} <span className="text-muted">· queued {formatQueueAge(item.createdAt)} ago{item.status ? ` · ${item.status}` : ""}</span>
                </span>
                {!reviewItems.some((r) => r.id === item.id) && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      void ask({
                        title: "Discard this queued change?",
                        message: "It will not be saved.",
                        confirmLabel: "Discard",
                        destructive: true,
                      }).then((ok) => {
                        if (ok !== null) void act(removeOutboxItem, item.id);
                      });
                    }}
                  >
                    Discard
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {reviewItems.length > 0 && (
        <ul className="divide-y divide-border border-b border-border bg-surface text-sm" aria-label="Changes that need review">
          {reviewItems.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span>
                <strong>{describeItem(item)}</strong>
                {item.status === "conflict"
                  ? " — changed by someone else: "
                  : item.status === "auth" || item.status === "foreign"
                    ? " — "
                    : " — not accepted: "}
                {item.lastError}
              </span>
              <span className="flex shrink-0 gap-3">
                {item.status === "conflict" ? (
                  <button type="button" className="font-medium underline" onClick={() => act(forceOutboxItem, item.id).then(attemptSync)}>
                    Keep mine
                  </button>
                ) : (
                  <button type="button" className="font-medium underline" onClick={() => act(resetOutboxItem, item.id).then(attemptSync)}>
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    void ask({
                      title: "Discard this queued change?",
                      message: "It will not be saved.",
                      confirmLabel: "Discard",
                      destructive: true,
                    }).then((ok) => {
                      if (ok !== null) void act(removeOutboxItem, item.id);
                    });
                  }}
                >
                  {item.status === "conflict" ? "Use server version" : "Discard"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
