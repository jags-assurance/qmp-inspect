import { RootCausesView } from "./root-causes-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <RootCausesView searchParams={await searchParams} />;
}
