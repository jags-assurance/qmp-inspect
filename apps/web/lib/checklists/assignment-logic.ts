// Pure rules for per-person activity assignment. The database function assign_activity_to_user
// (20261114000101) enforces the same rules; these mirror them for UI gating and tests.

export function canAssignActivity(input: { isStaff: boolean; isClientTeamLead: boolean; isExecutingPartyContact: boolean }): boolean {
  return input.isStaff || input.isClientTeamLead || input.isExecutingPartyContact;
}

export function isValidAssignee(input: { assigneeIsStaff: boolean; assigneeIsExecutingPartyMember: boolean }): boolean {
  return input.assigneeIsStaff || input.assigneeIsExecutingPartyMember;
}

export interface AssignableRow {
  assignedToUserId: string | null;
}

export function filterAssignedToMe<T extends AssignableRow>(rows: T[], userId: string): T[] {
  return rows.filter((r) => r.assignedToUserId === userId);
}

export function parseAssignedFilter(value: string | undefined | null): "me" | "" {
  return value === "me" ? "me" : "";
}
