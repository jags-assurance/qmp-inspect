import { ActivityView } from "./activity-view";

export default async function ProjectActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string; cat?: string; limit?: string }>;
}) {
  const { projectId } = await params;
  const { range, cat, limit } = await searchParams;
  return <ActivityView projectId={projectId} range={range} filters={{ cat, limit }} />;
}
