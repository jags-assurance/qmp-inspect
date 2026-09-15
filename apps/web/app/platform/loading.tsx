// Shown while PlatformHomePage's data resolves, so a slow load never shows a half-drawn ring (the
// heading and the active module's icon missing while the rest of the circles render) — the exact
// glitch this was added to fix. Mirrors that page's layout 1:1 (same ring radius, circle count and
// positions, same container sizing) so the swap from skeleton to real content causes no layout
// shift; only the content inside each shape is a pulsing placeholder instead of real data.

const PLACEHOLDER_COUNT = 9;
const RING_RADIUS = 168;

export default function PlatformHomeLoading() {
  return (
    <div>
      <div className="h-8 w-64 animate-pulse rounded bg-off-white" />
      <div className="mt-2 h-4 w-[28rem] max-w-full animate-pulse rounded bg-off-white" />

      <div className="relative mx-auto mt-4 flex h-[410px] w-full max-w-2xl items-center justify-center">
        <div
          className="pointer-events-none absolute rounded-full border border-border"
          style={{ width: RING_RADIUS * 2, height: RING_RADIUS * 2 }}
        />

        <div className="flex h-[86px] w-[86px] animate-pulse items-center justify-center rounded-full border-4 border-border bg-off-white" />

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
              <div className="h-12 w-12 animate-pulse rounded-full border-2 border-border bg-off-white" />
              <div className="h-3 w-20 animate-pulse rounded bg-off-white" />
              <div className="h-4 w-14 animate-pulse rounded-full bg-off-white" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
