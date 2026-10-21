// Time-based part of the sign-off automation (a notified Witness/Surveillance point whose notice period
// ran out): the logic lives in the web app (apps/web/lib/signoff/automation.ts) next to the manual
// notify/proceed code, so this worker only asks the web app to run its sweep. One copy of the rules.
// It does nothing unless both PUBLIC_APP_URL (or NEXT_PUBLIC_APP_URL) and CRON_SECRET are set, and the web app
// does nothing for an organisation that has not switched the automation on.

export interface SignoffSweepConfig {
  baseUrl: string;
  secret: string;
}

export function signoffSweepConfig(env: NodeJS.ProcessEnv = process.env): SignoffSweepConfig | null {
  const baseUrl = (env.PUBLIC_APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const secret = (env.CRON_SECRET ?? "").trim();
  if (!/^https?:\/\//i.test(baseUrl) || !secret) return null;
  return { baseUrl, secret };
}

export async function runSignoffAutomationSweep(
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ran: boolean; status?: number }> {
  const config = signoffSweepConfig(env);
  if (!config) return { ran: false };
  const res = await fetchImpl(`${config.baseUrl}/api/cron/signoff-automation`, {
    method: "GET",
    headers: { authorization: `Bearer ${config.secret}` },
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) throw new Error(`Sign-off automation sweep returned HTTP ${res.status}`);
  return { ran: true, status: res.status };
}
