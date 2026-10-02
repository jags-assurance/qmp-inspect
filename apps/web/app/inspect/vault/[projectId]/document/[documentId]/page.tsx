import { VaultDocumentView } from "./vault-document-view";

export default async function VaultDocumentPage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>;
}) {
  const { projectId, documentId } = await params;
  return <VaultDocumentView projectId={projectId} documentId={documentId} />;
}
