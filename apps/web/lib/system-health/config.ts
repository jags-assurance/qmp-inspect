// Pure configuration-health rules. Reports ON/OFF per feature from the environment WITHOUT exposing any value.

export interface FeatureHealth {
  key: string;
  label: string;
  on: boolean;
  /** Short plain-language note (never contains an env value). */
  note: string;
  warning?: string;
}

type Env = Record<string, string | undefined>;
const set = (v: string | undefined) => Boolean(v && v.trim());

export function looksLikeResendSandboxSender(from: string | undefined): boolean {
  return /onboarding@resend\.dev/i.test(from ?? "");
}

export function computeConfigHealth(env: Env): FeatureHealth[] {
  const emailKey = set(env.RESEND_API_KEY);
  const emailFrom = set(env.NOTIFICATIONS_EMAIL_FROM);
  const sandbox = looksLikeResendSandboxSender(env.NOTIFICATIONS_EMAIL_FROM);
  const emailOn = emailKey && emailFrom;
  const aiKey = set(env.GEMINI_API_KEY);
  const aiTier = set(env.AI_TIER);
  return [
    {
      key: "email",
      label: "Email sending",
      on: emailOn,
      note: emailOn ? "API key and sender address are set." : "Needs RESEND_API_KEY and NOTIFICATIONS_EMAIL_FROM.",
      warning: sandbox ? "The sender address looks like the Resend test sender, which only delivers to the account owner." : undefined,
    },
    {
      key: "app_url",
      label: "App URL",
      on: set(env.NEXT_PUBLIC_APP_URL),
      note: set(env.NEXT_PUBLIC_APP_URL) ? "Set." : "NEXT_PUBLIC_APP_URL is missing, so links in emails may be wrong.",
    },
    {
      key: "sentry",
      label: "Error reporting (Sentry)",
      on: set(env.SENTRY_DSN),
      note: set(env.SENTRY_DSN) ? "Set." : "SENTRY_DSN is missing, so errors are not reported.",
    },
    {
      key: "ai",
      label: "AI features",
      on: aiKey && aiTier,
      note: aiKey && aiTier ? "API key and tier are set." : "Needs GEMINI_API_KEY and AI_TIER.",
    },
  ];
}

export function disabledFeatureNames(features: FeatureHealth[]): string[] {
  return features.filter((f) => !f.on).map((f) => f.label);
}

/** Single startup warning line, or null when everything is configured. */
export function startupWarning(env: Env): string | null {
  const features = computeConfigHealth(env);
  const off = disabledFeatureNames(features);
  const parts: string[] = [];
  if (off.length > 0) parts.push(`disabled features (missing configuration): ${off.join(", ")}`);
  const sandbox = features.find((f) => f.warning);
  if (sandbox) parts.push("email sender looks like the Resend test sender");
  return parts.length > 0 ? `[config] ${parts.join("; ")}.` : null;
}

export interface HeartbeatInfo {
  lastActivityIso: string | null;
  ageSeconds: number | null;
  status: "ok" | "stale" | "unknown";
}

export const WORKER_STALE_AFTER_SECONDS = 30 * 60;

export function workerHeartbeat(latestIsoValues: (string | null | undefined)[], nowMs: number): HeartbeatInfo {
  const times = latestIsoValues.map((v) => (v ? new Date(v).getTime() : NaN)).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return { lastActivityIso: null, ageSeconds: null, status: "unknown" };
  const latest = Math.max(...times);
  const ageSeconds = Math.max(0, Math.round((nowMs - latest) / 1000));
  return { lastActivityIso: new Date(latest).toISOString(), ageSeconds, status: ageSeconds > WORKER_STALE_AFTER_SECONDS ? "stale" : "ok" };
}
