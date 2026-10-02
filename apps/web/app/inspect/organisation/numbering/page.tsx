import { NumberingSettingsView } from "./numbering-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <NumberingSettingsView searchParams={await searchParams} />;
}
