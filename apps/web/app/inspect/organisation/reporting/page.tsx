import { ReportingView } from "./reporting-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <ReportingView searchParams={await searchParams} />;
}
