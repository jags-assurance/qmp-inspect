// S1-12: what changing an organisation's engagement scope actually changes. Pure (no Supabase), so the
// confirmation text shown before the change, the audit entry written after it, and the tests all use the
// same wording. The tiers are cumulative: self_managed includes everything full_service has and adds
// client self-service; client_managed includes self_managed and adds approval / login creation.

export const ENGAGEMENT_SCOPES = ["full_service", "self_managed", "client_managed"] as const;
export type EngagementScope = (typeof ENGAGEMENT_SCOPES)[number];

export const SCOPE_LABEL: Record<EngagementScope, string> = {
  full_service: "Full-Managed (JAGS runs the project)",
  self_managed: "Self-Managed (Hybrid)",
  client_managed: "Full Client-Managed",
};

const RANK: Record<EngagementScope, number> = { full_service: 0, self_managed: 1, client_managed: 2 };

/** What each tier ADDS over the one below it. */
const ADDED_BY_TIER: Record<EngagementScope, string[]> = {
  full_service: [],
  self_managed: [
    "The client's own teams create, submit and accept their own ITPs on every project (a JAGS staff member still approves each one).",
    "The client can create its own projects and add contractor, vendor and client parties to them.",
    "The client's own admins can manage its numbering format, brand colours, client teams and custom roles.",
  ],
  client_managed: [
    "The client's own people can approve their own ITPs and create new logins for their team (both still need the matching custom-role permission).",
    "The client's custom roles can be given the run-standalone-assignment permission.",
  ],
};

export function isEngagementScope(value: string | null | undefined): value is EngagementScope {
  return (ENGAGEMENT_SCOPES as readonly string[]).includes(value ?? "");
}

export type ScopeChangeDirection = "none" | "upgrade" | "downgrade";

export interface ScopeImpact {
  direction: ScopeChangeDirection;
  /** What the client's people can do after the change that they could not before. */
  gains: string[];
  /** What they can no longer do. */
  losses: string[];
  /** Custom-role permissions that are removed automatically (leaving Full Client-Managed); null when not applicable. */
  revokedPermissions: number | null;
  /** Things that do NOT change, so nobody fears a data loss that is not happening. */
  unchanged: string[];
  requiresConfirmation: boolean;
}

/**
 * @param tierOnlyPermissionCount how many custom-role permissions that only exist on Full Client-Managed
 *   (approve ITP, provision login, run standalone) are currently granted in this organisation, when known.
 */
export function summarizeScopeChange(from: EngagementScope, to: EngagementScope, tierOnlyPermissionCount: number | null = null): ScopeImpact {
  if (from === to) {
    return { direction: "none", gains: [], losses: [], revokedPermissions: null, unchanged: [], requiresConfirmation: false };
  }
  const upgrade = RANK[to] > RANK[from];
  const between = ENGAGEMENT_SCOPES.filter((s) => (upgrade ? RANK[s] > RANK[from] && RANK[s] <= RANK[to] : RANK[s] > RANK[to] && RANK[s] <= RANK[from]));
  const changed = between.flatMap((s) => ADDED_BY_TIER[s]);
  const leavingClientManaged = from === "client_managed" && to !== "client_managed";
  return {
    direction: upgrade ? "upgrade" : "downgrade",
    gains: upgrade ? changed : [],
    losses: upgrade ? [] : changed,
    revokedPermissions: leavingClientManaged ? (tierOnlyPermissionCount ?? 0) : null,
    unchanged: [
      "Existing projects, parties, ITPs, inspections and documents are not changed or removed.",
      "Anything already approved stays approved.",
    ],
    requiresConfirmation: true,
  };
}

/** One-paragraph text for the confirmation prompt, the server error and the audit summary. */
export function describeScopeChange(from: EngagementScope, to: EngagementScope, impact: ScopeImpact): string {
  if (impact.direction === "none") return "No change.";
  const head = `Changing ${SCOPE_LABEL[from]} to ${SCOPE_LABEL[to]} takes effect immediately for everyone in the organisation.`;
  const parts: string[] = [head];
  if (impact.gains.length > 0) parts.push(`They gain: ${impact.gains.join(" ")}`);
  if (impact.losses.length > 0) parts.push(`They lose: ${impact.losses.join(" ")}`);
  if (impact.revokedPermissions !== null) {
    parts.push(
      impact.revokedPermissions > 0
        ? `${impact.revokedPermissions} custom-role permission${impact.revokedPermissions === 1 ? "" : "s"} (approve ITP, create logins, run standalone) will be removed.`
        : "Any custom-role permissions that only exist on Full Client-Managed (approve ITP, create logins, run standalone) will be removed."
    );
  }
  return parts.join(" ");
}
