"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tx } from "@/components/domain/tx";

/**
 * Admin-only pages send other users back to the dashboard with `?denied=1`; this explains why they
 * landed there instead of on the page they asked for, and is dismissible (clears the parameter).
 */
export function AccessDeniedNotice() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  if (params.get("denied") !== "1") return null;

  function dismiss() {
    const next = new URLSearchParams(params.toString());
    next.delete("denied");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-warning bg-warning/10 px-4 py-3 text-sm text-ink">
      <p>
        <strong><Tx>That page is only available to administrators.</Tx></strong>{" "}
        <Tx>You have been returned to the dashboard. Ask your JAGS administrator if you need access.</Tx>
      </p>
      <button type="button" onClick={dismiss} className="min-h-9 shrink-0 rounded-md px-2 font-medium text-brand hover:underline [@media(pointer:coarse)]:min-h-11">
        <Tx>Dismiss</Tx>
      </button>
    </div>
  );
}
