import { RegistersView } from "./registers-view";

export default async function RegistersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <RegistersView projectId={projectId} />;
}
