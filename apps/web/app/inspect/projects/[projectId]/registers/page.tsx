import { parseListLimit } from "@/lib/pagination/list-limit";
import { RegistersView, REGISTER_LIMITS } from "./registers-view";

export default async function RegistersPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  return <RegistersView projectId={projectId} limit={parseListLimit(sp.limit, REGISTER_LIMITS)} searchParams={sp} />;
}
