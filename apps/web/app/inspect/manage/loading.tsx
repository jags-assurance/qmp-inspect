import { T } from "@/components/domain/t";
import { PageHeaderSkeleton, Skeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading">
      <PageHeaderSkeleton action={false} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg border border-border" />
        ))}
      </div>
      <span className="sr-only"><T>Loading</T></span>
    </div>
  );
}
