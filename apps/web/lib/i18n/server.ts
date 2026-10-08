import { cookies } from "next/headers";
import { translateText } from "./dictionary";
import { LOCALE_COOKIE, normalizeLocale, type SupportedLocale } from "./direction";

/** The UI locale from the cookie (English when unset). Server components and actions only. */
export async function getLocale(): Promise<SupportedLocale> {
  return normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

/** A `t(text)` function bound to the current locale. English text is returned unchanged. */
export async function getTranslator(): Promise<(text: string) => string> {
  const locale = await getLocale();
  return (text) => translateText(locale, text);
}
