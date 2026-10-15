import { T } from "@/components/domain/t";
import { PageHeaderSkeleton, StatGridSkeleton, Skeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading">
      <PageHeaderSkeleton />
      <div className="mb-5"><StatGridSkeleton tiles={4} /></div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-full max-w-xs rounded-md" />
        <Skeleton className="h-10 w-28 rounded-md" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-none border-b border-border" />
        ))}
      </div>
      <span className="sr-only"><T>Loading</T></span>
    </div>
  );
}
