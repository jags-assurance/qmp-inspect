"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { JOURNEY_STORAGE_KEY } from "@/lib/journey/storage";
import { Tx } from "@/components/domain/tx";

type Ctx = { org: string | null; project: string | null; step?: string };

/**
 * A slim strip shown after someone opens a step from the Workflow page: one click back to the list so they
 * never have to remember which section comes next. It only appears for a person who started from Workflow.
 */
export function JourneyReturnBar() {
  const pathname = usePathname();
  const [ctx, setCtx] = useState<Ctx | null>(null);

  useEffect(() => {
    if (pathname.startsWith("/inspect/journey")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading sessionStorage after mount (not available on the server)
      setCtx(null);
      return;
    }
    try {
      const raw = sessionStorage.getItem(JOURNEY_STORAGE_KEY);
      setCtx(raw ? (JSON.parse(raw) as Ctx) : null);
    } catch {
      setCtx(null);
    }
  }, [pathname]);

  if (!ctx) return null;
  const qs = new URLSearchParams();
  if (ctx.org) qs.set("org", ctx.org);
  if (ctx.project) qs.set("project", ctx.project);
  return (
    <div className="no-print flex flex-wrap items-center gap-3 border-b border-success/40 bg-success/10 px-3 py-2 text-sm sm:px-6 lg:px-8">
      <Link href={`/inspect/journey${qs.size ? `?${qs}` : ""}`} className="font-medium text-ink underline">
        ← <Tx>Back to Workflow</Tx>
      </Link>
      {ctx.step && (
        <span className="text-muted">
          <Tx>Current step:</Tx> {ctx.step}
        </span>
      )}
      <button
        type="button"
        className="ms-auto text-xs text-muted underline"
        onClick={() => {
          try {
            sessionStorage.removeItem(JOURNEY_STORAGE_KEY);
          } catch {
            /* ignore */
          }
          setCtx(null);
        }}
      >
        <Tx>Hide</Tx>
      </button>
    </div>
  );
}
