import { InterventionLevelsSettingsView } from "./intervention-levels-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <InterventionLevelsSettingsView searchParams={await searchParams} />;
}
