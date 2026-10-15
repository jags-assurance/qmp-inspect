// Real gap found in a UX audit: none of the ~46 route segments under /inspect had a loading.tsx (only
// /platform did) — every Server Component here does an async data fetch before rendering anything, so
// clicking into an ITP, project, or checklist showed no feedback at all beyond the browser's own tab
// spinner; the previous page just sat there looking unresponsive until the new page's fetch resolved.
// This one generic skeleton, placed at the /inspect layout level, covers every nested route that
// doesn't define its own more tailored loading.tsx (Next.js falls back to the nearest ancestor).

export default function InspectLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="h-7 w-72 max-w-full animate-pulse rounded bg-surface-sunken" />
      <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-surface-sunken" />

      <div className="mt-6 flex flex-wrap gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-32 animate-pulse rounded-md bg-surface-sunken" />
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 w-full animate-pulse rounded-lg border border-border bg-surface-sunken" />
        ))}
      </div>
    </div>
  );
}
