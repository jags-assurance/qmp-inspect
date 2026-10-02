import { KpisView } from "./kpis-view";

export default async function ProjectKpisPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <KpisView projectId={projectId} />;
}
