"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { JOURNEY_STORAGE_KEY } from "@/lib/journey/storage";

/** A link from the Workflow page that remembers where the person came from, so the return bar can bring them back. */
export function JourneyLink({ href, ctx, stepTitle, className, children }: { href: string; ctx: string; stepTitle: string; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        try {
          sessionStorage.setItem(JOURNEY_STORAGE_KEY, JSON.stringify({ ...JSON.parse(ctx), step: stepTitle }));
        } catch {
          /* private window: the bar just does not appear */
        }
      }}
    >
      {children}
    </Link>
  );
}
