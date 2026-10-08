/**
 * D12: stored ITP translations. Persisted on itps.translations (jsonb, migration 20261103000200) as
 * { [language]: { title, scope, translated_at, source_revision } }. Title and scope are translated;
 * activities are not (they are many and change often).
 */
export interface StoredItpTranslation {
  title: string;
  scope: string | null;
  translated_at: string;
  /** itps.revision at the moment of translation, so a later revision can be flagged as out of date. */
  source_revision: number;
}

export type ItpTranslations = Record<string, StoredItpTranslation>;

export function parseItpTranslations(raw: unknown): ItpTranslations {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ItpTranslations = {};
  for (const [lang, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (typeof e.title !== "string" || !e.title) continue;
    out[lang] = {
      title: e.title,
      scope: typeof e.scope === "string" ? e.scope : null,
      translated_at: typeof e.translated_at === "string" ? e.translated_at : "",
      source_revision: typeof e.source_revision === "number" ? e.source_revision : 0,
    };
  }
  return out;
}

/** Adds/replaces one language, keeping every other language already stored. */
export function mergeItpTranslation(existing: unknown, language: string, entry: StoredItpTranslation): ItpTranslations {
  return { ...parseItpTranslations(existing), [language]: entry };
}

export function isTranslationStale(entry: StoredItpTranslation, currentRevision: number): boolean {
  return entry.source_revision !== currentRevision;
}
