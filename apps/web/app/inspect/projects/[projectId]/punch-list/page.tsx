import { PunchListView } from "./punch-list-view";

export default async function PunchListPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <PunchListView projectId={projectId} />;
}
