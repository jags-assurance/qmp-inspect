export default function Loading() {
  return (
    <div aria-busy="true" role="status" aria-label="Loading">
      <div className="h-7 w-64 max-w-full animate-pulse rounded bg-off-white" />
      <div className="mt-6 flex gap-3">
        <div className="h-10 w-full max-w-xs animate-pulse rounded-md bg-off-white" />
        <div className="h-10 w-28 animate-pulse rounded-md bg-off-white" />
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse border-b border-border bg-off-white/60" />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
