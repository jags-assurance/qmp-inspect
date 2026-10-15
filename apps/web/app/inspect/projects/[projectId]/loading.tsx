import { T } from "@/components/domain/t";
import { PageHeaderSkeleton, StatGridSkeleton, TableSkeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading">
      <PageHeaderSkeleton />
      <StatGridSkeleton />
      <div className="mt-5">
        <TableSkeleton rows={6} filters={false} />
      </div>
      <span className="sr-only"><T>Loading</T></span>
    </div>
  );
}
