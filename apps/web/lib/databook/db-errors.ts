// Pure helpers for talking to RPCs that may not be deployed yet (see supabase/migrations/202611*).

/** True when an error means a DB object (function / column / table) is not deployed yet: callers fall back to the previous behaviour. */
export function isMissingDbObject(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["42883", "42703", "42P01", "PGRST202", "PGRST204", "PGRST205"].includes(code)) return true;
  return /could not find the function|schema cache|does not exist/i.test(error.message ?? "");
}

/** User-facing text for a compile_data_book() / withdraw_data_book() failure. */
export function bookTransitionErrorMessage(message: string | null | undefined, fallback: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("not ready")) {
    const detail = (message ?? "").split(":").slice(1).join(":").trim();
    return `This project isn't ready: ${detail || "gates are not met"}. An admin can use the override option with a documented reason.`;
  }
  if (m.includes("admin staff")) return "Only a JAGS Admin can do this (override compile, conditional issue or withdraw).";
  if (m.includes("reason")) return "A documented reason of at least 10 characters is required.";
  if (m.includes("only a draft") || m.includes("only a compiled")) return "The Data Book is no longer in the expected state. Refresh the page.";
  if (m.includes("handover certificate")) return "This Data Book already has a handover certificate.";
  return fallback;
}

/** Formats an ISO timestamp with an explicit UTC label (server and viewer zones differ; S7-24). */
export function formatUtcDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}

/** Formats a date-only value (YYYY-MM-DD or ISO) without shifting it into the server's zone. */
export function formatUtcDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
