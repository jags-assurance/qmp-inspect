"use client";

import { useState } from "react";
import { getLocalUserId } from "@/lib/offline/user";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";

/**
 * Asks the service worker to keep a copy of the listed checklist pages for this signed-in user, so
 * they open without signal (a reload or app relaunch on site). Copies are per user and wiped on
 * sign-out; see public/sw.js. Do this on site entry while there is still coverage.
 */
export function SaveOfflineButton({ urls }: { urls: string[] }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "unavailable">("idle");

  async function save() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      setState("unavailable");
      return;
    }
    setState("saving");
    try {
      const [userId, reg] = await Promise.all([getLocalUserId(), navigator.serviceWorker.ready]);
      if (!userId || !reg.active) {
        setState("unavailable");
        return;
      }
      reg.active.postMessage({ type: "REGISTER_USER", userId });
      reg.active.postMessage({ type: "CACHE_PAGES", userId, urls: urls.slice(0, 20) });
      setState("done");
    } catch {
      setState("unavailable");
    }
  }

  if (urls.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <Button
        type="button"
        onClick={save}
        disabled={state === "saving"}
        variant="outline"
      >
        {state === "saving" ? "Saving…" : "Save these checklists for offline"}
      </Button>
      {state === "done" && <span className="text-muted"><Tx>Saved on this device. They will open without signal until you sign out.</Tx></span>}
      {state === "unavailable" && <span className="text-muted"><Tx>Offline saving is not available in this browser.</Tx></span>}
    </div>
  );
}
