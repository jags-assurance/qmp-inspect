import { ItpDetailView } from "./itp-detail-view";

export default async function ItpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItpDetailView id={id} />;
}
