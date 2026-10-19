import { getLocale } from "@/lib/i18n/server";
import { loadTermOverrides } from "@/lib/terminology/load";
import { applyTerms } from "@/lib/terminology/terms";
import { translateText } from "@/lib/i18n/dictionary";

/**
 * Server helper: renders `children` (the English text, which is also the dictionary key) translated for
 * the current locale. English output is identical to rendering the text directly.
 * Usage: <h1><T>Projects</T></h1>
 */
export async function T({ children }: { children: string }) {
  return <>{applyTerms(translateText(await getLocale(), children), await loadTermOverrides())}</>;
}
