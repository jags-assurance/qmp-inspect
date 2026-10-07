// Builds the ILIKE pattern for the record search, safe to embed in a PostgREST `.or()` filter string.

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 60;

/**
 * Returns `*term*` (PostgREST wildcard) or null when the query is too short. Characters that are
 * special in an `.or()` expression (comma, parentheses, quotes, backslash) and ILIKE wildcards are
 * removed rather than escaped — an NCR/ITP number or a name never needs them, and stripping keeps a
 * crafted query from adding extra filter clauses.
 */
export function buildLikePattern(raw: string): string | null {
  const cleaned = raw.replace(/[,()"'\\%_*:]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  if (cleaned.length < MIN_QUERY_LENGTH) return null;
  return `*${cleaned}*`;
}
