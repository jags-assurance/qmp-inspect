import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import {
  parseRegisterStats,
  registerStatsFromRows,
  registerStatsRpcArgs,
  type ObservationStatRow,
  type RegisterStatsParams,
  type RegisterStatsResult,
} from "./register-stats";

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

/**
 * Stat-card numbers for the NCR / Observation registers from the `register_stats` SQL aggregate (one
 * round trip, no row cap). While that migration is not applied yet it falls back to `fetchRows`, the
 * previous paged scan, so the page keeps working either way.
 */
export async function loadRegisterStats(
  supabase: unknown,
  params: RegisterStatsParams,
  fetchRows: () => Promise<ObservationStatRow[]>
): Promise<RegisterStatsResult> {
  const { data, error } = await (supabase as RpcClient).rpc("register_stats", registerStatsRpcArgs(params));
  if (!error) {
    const parsed = parseRegisterStats(data);
    if (parsed) return parsed;
  } else if (!isMissingSchemaError(error)) {
    throw new Error(`Register statistics failed: ${error.message ?? error.code ?? "unknown error"}`);
  }
  return registerStatsFromRows(await fetchRows(), params.nowMs, params.todayIso);
}
