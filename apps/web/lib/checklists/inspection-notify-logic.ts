// Pure recipient logic for checklist-module notifications (no I/O, unit-tested).

/** Unique, non-empty ids in first-seen order, never including `excludeUserId` (the actor). */
export function dedupeRecipients(ids: (string | null | undefined)[], excludeUserId?: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || id === excludeUserId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Who hears that an inspection STARTED: the project's responsible person plus JAGS staff on it. */
export function inspectionStartRecipients(input: {
  responsiblePersonId: string | null;
  projectStaffIds: string[];
  actorId: string | null;
}): string[] {
  return dedupeRecipients([input.responsiblePersonId, ...input.projectStaffIds], input.actorId);
}

/** Who hears that an inspection PASSED: the assignee first, else the party/ITP responsible people. */
export function inspectionPassRecipients(input: {
  assignedToUserId: string | null;
  responsibleUserIds: string[];
  actorId: string | null;
}): string[] {
  const primary = input.assignedToUserId ? [input.assignedToUserId] : input.responsibleUserIds;
  return dedupeRecipients(primary, input.actorId);
}

export function assignmentNotification(activity: string, assignerName: string | null): { title: string; body: string } {
  return {
    title: "Activity assigned to you",
    body: `${activity}${assignerName ? ` - assigned by ${assignerName}` : ""}`,
  };
}
