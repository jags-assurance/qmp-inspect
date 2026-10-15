import { PageHeaderSkeleton, Skeleton, StatGridSkeleton } from "@/components/ui/skeletons";
import { T } from "@/components/domain/t";

// Generic fallback for every /inspect route without its own loading.tsx (Next.js uses the nearest
// ancestor): a PageHeader, a stat row and a list panel, matching the design system's page rhythm.
// List routes (ITPs, NCRs) have their own tailored skeleton.

export default function InspectLoading() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading">
      <PageHeaderSkeleton />
      <div className="space-y-5">
        <StatGridSkeleton tiles={4} />
        <div aria-hidden="true" className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg border border-border" />
          ))}
        </div>
      </div>
      <span className="sr-only"><T>Loading</T></span>
    </div>
  );
}
