import { AutomationRulesView } from "./automation-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <AutomationRulesView searchParams={await searchParams} />;
}
