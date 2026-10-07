import { headers } from "next/headers";

/**
 * The public base URL of this deployment, used for links that leave the app (password-reset emails).
 * Never taken from the request's Origin header (spoofable on a direct post). Order: the configured
 * NEXT_PUBLIC_APP_URL, then Vercel's own deployment env vars, then the Host header (which the
 * platform sets itself) as a last resort for local development.
 */
export async function getAppUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
