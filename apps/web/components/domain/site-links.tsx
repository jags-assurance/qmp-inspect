"use client";

import Link from "next/link";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Small row of links shown in the app footer, on the sign-in page and on the public pages: help,
 * privacy, terms and release notes. `signedIn` switches the two signed-in-only destinations
 * (support, what's new) off for the signed-out pages, which only get the public ones.
 */
export function SiteLinks({ signedIn, className = "" }: { signedIn: boolean; className?: string }) {
  const tl = useTranslate();
  const link = "text-xs text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-burgundy";
  return (
    <nav aria-label={tl("Help and legal")} className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
      {signedIn && (
        <Link href="/inspect/support" className={link}>
          <Tx>Help and support</Tx>
        </Link>
      )}
      <Link href="/privacy" className={link}>
        <Tx>Privacy notice</Tx>
      </Link>
      <Link href="/terms" className={link}>
        <Tx>Terms of use</Tx>
      </Link>
      {signedIn && (
        <Link href="/inspect/whats-new" className={link}>
          <Tx>What&apos;s new</Tx>
        </Link>
      )}
    </nav>
  );
}
