// automation_rules/automation_notification_log aren't in the generated Database type yet — same
// documented escape hatch as ITP_REVIEW_CHAIN_MEMBERS_TABLE etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const AUTOMATION_RULES_TABLE = "automation_rules" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const AUTOMATION_NOTIFICATION_LOG_TABLE = "automation_notification_log" as any;

export type AutomationRuleType = "hold_elapsed" | "ncr_overdue" | "punch_overdue" | "register_expiry";

export const AUTOMATION_RULE_TYPES: AutomationRuleType[] = ["hold_elapsed", "ncr_overdue", "punch_overdue", "register_expiry"];

export const AUTOMATION_RULE_LABEL: Record<AutomationRuleType, string> = {
  hold_elapsed: "Stuck Hold reminder",
  ncr_overdue: "Overdue NCR reminder",
  punch_overdue: "Overdue punch item reminder",
  register_expiry: "Register expiry alert",
};

export const AUTOMATION_RULE_DESCRIPTION: Record<AutomationRuleType, string> = {
  hold_elapsed:
    "A Hold has been notified with no response for longer than the threshold below — nudges JAGS admins with access to this organisation.",
  ncr_overdue:
    "An open NCR's due date has passed — nudges its assignee (if set) plus JAGS admins.",
  punch_overdue:
    "An open or resolved-but-unverified punch list item's due date has passed — nudges the responsible party's linked login (if any) plus JAGS admins.",
  register_expiry:
    "A calibration (30 days), welder qualification (90) or personnel certification (90) is nearing expiry — alerts the project's responsible person (and the owning party's login for personnel certificates) once at the warning window, at 14 days, at 7 days and on expiry. Thresholds are fixed; the hours fields do not apply.",
};

export interface AutomationRuleRow {
  id: string;
  organization_id: string;
  rule_type: AutomationRuleType;
  enabled: boolean;
  threshold_hours: number;
  repeat_hours: number;
}
