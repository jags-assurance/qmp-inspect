"use client";

import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * Translates a short English string using the locale from the inspect layout. Unlike <T> (async,
 * server only) this renders from both server and client components, so shared UI primitives
 * (Badge, Watchlist) can translate their text without becoming async.
 */
export function Tx({ children }: { children: string }) {
  const t = useTranslate();
  return <>{t(children)}</>;
}
