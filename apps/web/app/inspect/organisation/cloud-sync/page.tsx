import { CloudFolderSyncView } from "./cloud-sync-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  return <CloudFolderSyncView searchParams={await searchParams} />;
}
