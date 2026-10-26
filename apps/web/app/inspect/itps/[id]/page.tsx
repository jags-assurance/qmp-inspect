import { ItpDetailView } from "./itp-detail-view";

// The detail page runs many queries in several rounds (4-6 s to first byte on the dev site); give it room so a
// slow round never ends in the generic error page.
export const maxDuration = 300;

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
