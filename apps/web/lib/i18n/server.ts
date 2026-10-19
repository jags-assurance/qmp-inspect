import { cookies } from "next/headers";
import { translateText } from "./dictionary";
import { loadTermOverrides } from "@/lib/terminology/load";
import { applyTerms } from "@/lib/terminology/terms";
import { LOCALE_COOKIE, normalizeLocale, type SupportedLocale } from "./direction";

/** The UI locale from the cookie (English when unset). Server components and actions only. */
export async function getLocale(): Promise<SupportedLocale> {
  return normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

/** A `t(text)` function bound to the current locale. English text is returned unchanged. */
export async function getTranslator(): Promise<(text: string) => string> {
  const locale = await getLocale();
  const terms = await loadTermOverrides();
  return (text) => applyTerms(translateText(locale, text), terms);
}
