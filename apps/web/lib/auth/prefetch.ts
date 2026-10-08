// Pure so it can be unit-tested; used by proxy.ts.

/** True for a Next.js router prefetch (Link in the viewport / on hover), not a real navigation. */
export function isPrefetchRequest(headers: { get(name: string): string | null }): boolean {
  return (
    headers.get("next-router-prefetch") === "1" ||
    headers.get("purpose") === "prefetch" ||
    headers.get("sec-purpose")?.includes("prefetch") === true
  );
}
