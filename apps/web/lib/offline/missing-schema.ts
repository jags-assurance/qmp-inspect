// Not a "use server" file: plain helper shared by server actions and route handlers.

/**
 * True when a PostgREST / Postgres error means "this column, table or function does not exist (yet)".
 * Code that depends on a newer migration uses this to fall back to its previous behaviour instead of
 * failing while the migration has not been applied.
 *   42703 undefined_column, 42P01 undefined_table, 42883 undefined_function,
 *   PGRST202 function not in schema cache, PGRST204 column not in schema cache, PGRST205 table not in schema cache
 */
export function isMissingSchemaError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code)) return true;
  return /could not find the .* column|schema cache/i.test(error.message ?? "");
}

/** A storage upload error that is a permission refusal (row-level security) rather than an outage. */
export function isStoragePermissionError(error: { message?: string | null; statusCode?: string | number | null } | null | undefined): boolean {
  if (!error) return false;
  const status = String(error.statusCode ?? "");
  return status === "403" || status === "401" || /row-level security|not authorized|permission denied|unauthorized/i.test(error.message ?? "");
}
