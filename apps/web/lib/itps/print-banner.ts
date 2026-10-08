/** Register print view (D14): the statuses it can filter by and the per-ITP revision/status/date banner line. */
export const PRINT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
};

export const PRINT_STATUSES = Object.keys(PRINT_STATUS_LABEL);

export function isPrintStatus(value: string | null | undefined): value is string {
  return !!value && PRINT_STATUSES.includes(value);
}

/** The date an ITP's current revision was issued (approval), else when it last changed. */
export function itpIssueDate(itp: { approved_at: string | null; updated_at: string | null }): string {
  const raw = itp.approved_at ?? itp.updated_at;
  return raw ? new Date(raw).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "—";
}

export function bannerLine(itp: { itp_number: string; revision: number; status: string; approved_at: string | null; updated_at: string | null }): string {
  return `${itp.itp_number} · Rev ${itp.revision} · ${PRINT_STATUS_LABEL[itp.status] ?? itp.status} · ${itpIssueDate(itp)}`;
}
