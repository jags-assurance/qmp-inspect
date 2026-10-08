import { isMissingSchemaError } from "@/lib/offline/missing-schema";

export interface AuditFacets {
  categories: string[];
  actors: [string, string][];
}

interface Rpc {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
interface FallbackRow {
  entity_type: string;
  actor_id: string | null;
  actor: { full_name: string } | null;
}

/** Parses the jsonb `audit_log_facets` returns; null when it is not that shape. */
export function parseAuditFacets(raw: unknown): AuditFacets | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { categories?: unknown; actors?: unknown };
  if (!Array.isArray(r.categories) || !Array.isArray(r.actors)) return null;
  const categories = r.categories.filter((c): c is string => typeof c === "string");
  const actors: [string, string][] = [];
  for (const a of r.actors) {
    const row = a as { id?: unknown; name?: unknown };
    if (typeof row?.id === "string") actors.push([row.id, typeof row.name === "string" ? row.name : "Unknown"]);
  }
  return { categories, actors };
}

/** The previous behaviour: de-duplicate a sample of recent rows. Used until the SQL function is applied. */
export function facetsFromRows(rows: ReadonlyArray<FallbackRow>): AuditFacets {
  return {
    categories: [...new Set(rows.map((r) => r.entity_type))].sort(),
    actors: [...new Map(rows.filter((r) => r.actor_id).map((r) => [r.actor_id as string, r.actor?.full_name ?? "Unknown"])).entries()],
  };
}

export async function loadAuditFacets(
  supabase: unknown,
  projectId: string,
  fetchSample: () => Promise<FallbackRow[]>
): Promise<AuditFacets> {
  const { data, error } = await (supabase as Rpc).rpc("audit_log_facets", { p_project_id: projectId });
  if (!error) {
    const parsed = parseAuditFacets(data);
    if (parsed) return parsed;
  } else if (!isMissingSchemaError(error)) {
    throw new Error(`Audit filter options failed: ${error.message ?? error.code ?? "unknown error"}`);
  }
  return facetsFromRows(await fetchSample());
}
