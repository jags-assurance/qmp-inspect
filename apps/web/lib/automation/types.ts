// automation_rules/automation_notification_log aren't in the generated Database type yet — same
// documented escape hatch as ITP_REVIEW_CHAIN_MEMBERS_TABLE etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const AUTOMATION_RULES_TABLE = "automation_rules" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const AUTOMATION_NOTIFICATION_LOG_TABLE = "automation_notification_log" as any;

export type AutomationRuleType = "hold_elapsed" | "ncr_overdue" | "punch_overdue";

export const AUTOMATION_RULE_TYPES: AutomationRuleType[] = ["hold_elapsed", "ncr_overdue", "punch_overdue"];

export const AUTOMATION_RULE_LABEL: Record<AutomationRuleType, string> = {
  hold_elapsed: "Stuck Hold reminder",
  ncr_overdue: "Overdue NCR reminder",
  punch_overdue: "Overdue punch item reminder",
};

export const AUTOMATION_RULE_DESCRIPTION: Record<AutomationRuleType, string> = {
  hold_elapsed:
    "A Hold has been notified with no response for longer than the threshold below — nudges JAGS admins with access to this organisation.",
  ncr_overdue:
    "An open NCR's due date has passed — nudges its assignee (if set) plus JAGS admins.",
  punch_overdue:
    "An open or resolved-but-unverified punch list item's due date has passed — nudges the responsible party's linked login (if any) plus JAGS admins.",
};

export interface AutomationRuleRow {
  id: string;
  organization_id: string;
  rule_type: AutomationRuleType;
  enabled: boolean;
  threshold_hours: number;
  repeat_hours: number;
}
