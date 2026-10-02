import { ChecklistsView } from "./checklists-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChecklistsView id={id} />;
}
