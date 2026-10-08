import { RetentionSettingsView } from "./retention-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <RetentionSettingsView searchParams={await searchParams} />;
}
