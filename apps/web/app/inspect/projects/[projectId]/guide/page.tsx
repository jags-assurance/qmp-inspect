import { GuideView } from "./guide-view";

export default async function ProjectGuidePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <GuideView projectId={projectId} />;
}
