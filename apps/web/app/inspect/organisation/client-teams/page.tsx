import { ClientTeamsView } from "./client-teams-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <ClientTeamsView searchParams={await searchParams} />;
}
