import { StatusView } from "./status-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StatusView id={id} />;
}
