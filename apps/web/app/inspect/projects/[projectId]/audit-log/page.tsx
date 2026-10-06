import { AuditLogView } from "./audit-log-view";

export default async function ProjectAuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string; cat?: string; actor?: string; limit?: string }>;
}) {
  const { projectId } = await params;
  const { range, cat, actor, limit } = await searchParams;
  return <AuditLogView projectId={projectId} range={range} filters={{ cat, actor, limit }} />;
}
