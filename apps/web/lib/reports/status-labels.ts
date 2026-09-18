// Pure constant, no imports — safe for both server pages and client components to import directly.
// Previously lived as an export inside app/inspect/projects/[projectId]/reports/page.tsx (a server
// page that itself imports lib/supabase/server.ts); importing it from there into a client component
// (monthly/weekly report pack forms) pulled the whole server-only module graph into the client
// bundle and broke the build. Pulled out here so both sides can share one definition safely.
export const REPORT_PACK_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};
