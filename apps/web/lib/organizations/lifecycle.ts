/** Pure validation for the organisation lifecycle actions (rename, deactivate, reactivate). */

export const ORG_NAME_MAX = 120;
export const ORG_REASON_MAX = 500;

export function validateOrganizationName(raw: string): { name: string; error: string | null } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { name, error: "Organisation name is required." };
  if (name.length > ORG_NAME_MAX) return { name, error: `Organisation name must be ${ORG_NAME_MAX} characters or fewer.` };
  return { name, error: null };
}

export function validateDeactivationReason(raw: string): { reason: string; error: string | null } {
  const reason = raw.trim();
  if (!reason) return { reason, error: "A reason is required to deactivate an organisation." };
  if (reason.length > ORG_REASON_MAX) return { reason, error: `The reason must be ${ORG_REASON_MAX} characters or fewer.` };
  return { reason, error: null };
}
