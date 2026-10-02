import { BrandingSettingsView } from "./branding-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <BrandingSettingsView searchParams={await searchParams} />;
}
