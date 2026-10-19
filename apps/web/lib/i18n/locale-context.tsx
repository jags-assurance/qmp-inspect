"use client";

import { createContext, useContext, type ReactNode } from "react";
import { translateText } from "./dictionary";
import type { SupportedLocale } from "./direction";
import { useTermOverrides } from "@/lib/terminology/terms-context";
import { applyTerms } from "@/lib/terminology/terms";

const LocaleContext = createContext<SupportedLocale>("en");

/** Supplies the UI locale to client components (set once in the inspect layout from the cookie). */
export function LocaleProvider({ locale, children }: { locale: SupportedLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): SupportedLocale {
  return useContext(LocaleContext);
}

/** Client-side `t`: English text in, display text out (English when there is no translation). */
export function useTranslate(): (text: string) => string {
  const locale = useLocale();
  const terms = useTermOverrides();
  return (text) => applyTerms(translateText(locale, text), terms);
}
