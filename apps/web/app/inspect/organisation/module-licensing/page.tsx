import { ModuleLicensingSettingsView } from "./module-licensing-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <ModuleLicensingSettingsView searchParams={await searchParams} />;
}
