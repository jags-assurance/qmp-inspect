import { ItpDetailView } from "./itp-detail-view";

export default async function ItpDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  return <ItpDetailView id={id} view={view === "matrix" ? "matrix" : "list"} />;
}
