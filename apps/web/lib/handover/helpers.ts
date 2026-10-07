// Pure helpers for the handover actions/UI (kept out of actions.ts: a "use server" file may only export async functions).

export interface GrantLike {
  user_id: string;
  role: string;
  scope_type?: string;
  organization_id?: string | null;
  project_id?: string | null;
}

/** Client-role users whose grant reaches this project (org-scope or project-scope), de-duplicated, minus excluded ids. */
export function clientRecipientIds(
  grants: GrantLike[],
  project: { id: string; organizationId: string },
  excludeUserIds: (string | null | undefined)[] = []
): string[] {
  const excluded = new Set(excludeUserIds.filter((v): v is string => Boolean(v)));
  const ids = new Set<string>();
  for (const g of grants) {
    if (g.role !== "client") continue;
    const reaches =
      (g.scope_type === "organization" && g.organization_id === project.organizationId) ||
      (g.scope_type === "project" && g.project_id === project.id) ||
      // Rows already filtered by organization/project in the query carry no scope_type.
      g.scope_type === undefined;
    if (!reaches || excluded.has(g.user_id)) continue;
    ids.add(g.user_id);
  }
  return [...ids];
}

/** Minimum length of a rejection / reopen reason (mirrors the 10-character check in reject_handover()). */
export const MIN_REJECT_REASON_LENGTH = 10;

/** Maps a reject_handover() / reopen_handover_rejection() error message to a distinct user-facing message. */
export function rejectErrorMessage(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("already acknowledged")) return "This handover has already been acknowledged, so it can no longer be rejected.";
  if (m.includes("already rejected")) return "This handover has already been rejected.";
  if (m.includes("superseded")) return "This certificate was superseded by a later revision.";
  if (m.includes("has not been rejected")) return "This certificate has not been rejected.";
  if (m.includes("admin staff")) return "Only a JAGS Admin can reopen a rejected handover certificate.";
  if (m.includes("client")) return "Only the client organisation can reject a handover package.";
  if (m.includes("reason")) return "Enter a reason (at least 10 characters).";
  if (m.includes("not found")) return "Certificate not found, or you do not have access to it.";
  return "Could not record this. Please try again, or contact JAGS Assurance.";
}

/** Maps an acknowledge_handover() error message to a distinct user-facing message. */
export function acknowledgeErrorMessage(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("already acknowledged")) return "This handover has already been acknowledged.";
  if (m.includes("rejected")) return "This certificate was rejected and can no longer be acknowledged.";
  if (m.includes("superseded")) return "This certificate was superseded by a later revision.";
  if (m.includes("client")) return "Only the client organisation can acknowledge receipt of a handover.";
  if (m.includes("package")) return "No package file is attached to this certificate, so it cannot be acknowledged. Contact JAGS Assurance.";
  if (m.includes("name")) return "Enter a valid name (check the length) to acknowledge receipt.";
  if (m.includes("not found")) return "Certificate not found, or you do not have access to it.";
  return "Could not record acknowledgement. Please try again, or contact JAGS Assurance.";
}

/** Maps an issue_data_book_handover() error message to a distinct user-facing message. */
export function issueErrorMessage(code: string | null | undefined, message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (code === "23505") return "A handover certificate already exists for this Data Book, or that certificate number is in use.";
  if (m.includes("not found in storage")) return "The uploaded package file could not be found in storage. Upload it again.";
  if (m.includes("not ready to issue")) return "The project no longer passes the Data Book gates (open punch items, NCRs, unapproved ITPs or project not completed). Resolve them or withdraw the book and compile with an override.";
  if (m.includes("admin staff")) return "Only a JAGS Admin, or JAGS staff granted the issue_handover permission, can issue a conditional handover.";
  if (m.includes("punch")) return "Open punch items exist, so the handover cannot be issued. Close them first.";
  if (m.includes("compiled")) return "Only a compiled Data Book can be issued. Refresh the page.";
  if (m.includes("staff")) return "Only JAGS staff can issue a handover certificate.";
  if (m.includes("path") || m.includes("sha")) return "The uploaded package reference was rejected. Re-upload the file and try again.";
  return "Could not issue the handover certificate. Check you have permission and try again.";
}
