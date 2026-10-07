import { ChecklistsView } from "./checklists-view";
import { parseArchiveFilter } from "@/lib/checklists/template-ui-logic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return <ChecklistsView id={id} archiveFilter={parseArchiveFilter(sp.archived)} />;
}
