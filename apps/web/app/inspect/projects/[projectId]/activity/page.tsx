import { ActivityView } from "./activity-view";

export default async function ProjectActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { projectId } = await params;
  const { range } = await searchParams;
  return <ActivityView projectId={projectId} range={range} />;
}
