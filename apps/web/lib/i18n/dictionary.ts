// UI text is English. This module holds the translation tables keyed by the English text itself, so
// components keep their English strings as the source of truth and only the DISPLAY changes: an unknown
// string simply stays English. No other language is offered at the moment; a Canadian French (fr-CA)
// table is added here when its translations are ready.
import type { SupportedLocale } from "./direction";


const DICTIONARIES: Partial<Record<SupportedLocale, Record<string, string>>> = {};

/** The display text for `text` in `locale`; the English original when there is no translation. */
export function translateText(locale: SupportedLocale, text: string): string {
  return DICTIONARIES[locale]?.[text] ?? text;
}

interface NavLike {
  label: string;
  group?: string;
  displayLabel?: string;
  displayGroup?: string;
  children?: NavLike[];
  palette?: NavLike[];
}

/** Adds displayLabel / displayGroup to a navigation tree (labels stay English for icons and storage keys). */
export function localizeNavItems<T extends NavLike>(items: T[], locale: SupportedLocale): T[] {
  if (!DICTIONARIES[locale]) return items;
  return items.map((item) => {
    const next: T = { ...item, displayLabel: translateText(locale, item.label) };
    if (item.group) next.displayGroup = translateText(locale, item.group);
    if (item.children) next.children = localizeNavItems(item.children as T[], locale) as T["children"];
    if (item.palette) next.palette = localizeNavItems(item.palette as T[], locale) as T["palette"];
    return next;
  });
}
