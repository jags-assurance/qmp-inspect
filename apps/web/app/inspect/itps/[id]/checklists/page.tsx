import { ChecklistsView } from "./checklists-view";
import { parseArchiveFilter } from "@/lib/checklists/template-ui-logic";

/** "Generate checklists with AI" runs as a server action on this page; give it the same headroom as the ITP draft. */
export const maxDuration = 300;

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
