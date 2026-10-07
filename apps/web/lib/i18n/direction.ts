// G-02: text direction support. Pure (no next/headers import) so it unit-tests cleanly; the cookie
// read lives in app/layout.tsx and the cookie write in ./actions.ts.
//
// The UI strings are still English (see the i18n note in eslint.config.mjs); what this adds is the
// plumbing that makes an Arabic (or other right-to-left) locale lay out correctly: the <html lang dir>
// attributes, and logical Tailwind utilities (ps/pe/ms/me, start/end, text-start/end) in the shell.

export const SUPPORTED_LOCALES = ["en", "ar"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";

/** Cookie that stores the chosen UI locale (not security sensitive). */
export const LOCALE_COOKIE = "qmp_locale";

/** Base language subtags that are written right to left. */
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "dv"]);

export type TextDirection = "ltr" | "rtl";

/** Lower-cased base language of a BCP 47 tag ("ar-SA" -> "ar"), or "" when it is not a plausible tag. */
function baseLanguage(tag: string | null | undefined): string {
  if (!tag) return "";
  const base = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(base) ? base : "";
}

/** Whether a locale tag is written right to left. Unknown / empty tags are LTR. */
export function isRtlLocale(tag: string | null | undefined): boolean {
  return RTL_LANGUAGES.has(baseLanguage(tag));
}

export function directionFor(tag: string | null | undefined): TextDirection {
  return isRtlLocale(tag) ? "rtl" : "ltr";
}

/** Maps any stored / supplied value onto a supported locale, falling back to the default. */
export function normalizeLocale(value: string | null | undefined): SupportedLocale {
  const base = baseLanguage(value);
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as SupportedLocale) : DEFAULT_LOCALE;
}

/** Attributes for the root <html> element. */
export function htmlAttributesFor(value: string | null | undefined): { lang: SupportedLocale; dir: TextDirection } {
  const lang = normalizeLocale(value);
  return { lang, dir: directionFor(lang) };
}

/** Display name of each locale in its own language, for the switcher. */
export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  ar: "العربية",
};
