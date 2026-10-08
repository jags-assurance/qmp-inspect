import { parseListLimit } from "@/lib/pagination/list-limit";
import { PunchListView, PUNCH_CLOSED_LIMITS } from "./punch-list-view";

export default async function PunchListPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  return <PunchListView projectId={projectId} closedLimit={parseListLimit(sp.limit, PUNCH_CLOSED_LIMITS)} searchParams={sp} />;
}
