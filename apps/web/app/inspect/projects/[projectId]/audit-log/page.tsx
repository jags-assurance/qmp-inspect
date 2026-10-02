import { AuditLogView } from "./audit-log-view";

export default async function ProjectAuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { projectId } = await params;
  const { range } = await searchParams;
  return <AuditLogView projectId={projectId} range={range} />;
}
