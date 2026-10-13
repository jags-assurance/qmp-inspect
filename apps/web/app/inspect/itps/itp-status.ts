// Plain module (not "use client"): the ITP list page is a server component, and a constant imported
// from a client module reaches it as undefined, which left the status filter chips unlabelled.
export const ITP_STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "gold"> = {
  draft: "neutral",
  under_review: "warning",
  approved: "gold",
  client_accepted: "success",
  superseded: "neutral",
  withdrawn: "neutral",
};

export const ITP_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  under_review: "Under review",
  approved: "Approved",
  client_accepted: "Client accepted",
  superseded: "Superseded",
  withdrawn: "Withdrawn",
};
