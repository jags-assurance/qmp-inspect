import { DataBookView } from "./data-book-view";

export default async function DataBookPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <DataBookView projectId={projectId} />;
}
