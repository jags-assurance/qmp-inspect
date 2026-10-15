// Shown while PlatformHomePage's data resolves. Below 1024px the page is a card grid of modules, from
// lg it is the orbit diagram, so the skeleton mirrors both (same ring radius, circle count and
// container sizing) and the swap to real content causes no layout shift.
import { PageHeaderSkeleton, Skeleton } from "@/components/ui/skeletons";

const PLACEHOLDER_COUNT = 9;
const RING_RADIUS = 168;

export default function PlatformHomeLoading() {
  return (
    <div aria-busy="true">
      <PageHeaderSkeleton action={false} />

      <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {Array.from({ length: PLACEHOLDER_COUNT }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg border border-border" />
        ))}
      </div>

      <div className="relative mx-auto mt-4 hidden h-[410px] w-full max-w-2xl items-center justify-center lg:flex">
        <div
          className="pointer-events-none absolute rounded-full border border-border"
          style={{ width: RING_RADIUS * 2, height: RING_RADIUS * 2 }}
        />

        <Skeleton className="h-[86px] w-[86px] rounded-full border-4 border-border" />

        {Array.from({ length: PLACEHOLDER_COUNT }).map((_, i) => {
          const angle = (i / PLACEHOLDER_COUNT) * 2 * Math.PI - Math.PI / 2;
          const x = RING_RADIUS * Math.cos(angle);
          const y = RING_RADIUS * Math.sin(angle);
          return (
            <div
              key={i}
              className="absolute flex flex-col items-center gap-1.5"
              style={{ transform: `translate(${x}px, ${y}px)` }}
            >
              <Skeleton className="h-12 w-12 rounded-full border-2 border-border" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
