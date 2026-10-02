import { ReportsView } from "./reports-view";

export default async function ProjectReportsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ReportsView projectId={projectId} />;
}
