import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto my-20 max-w-md rounded-lg border border-border bg-surface p-6 text-center">
      <h1 className="text-xl font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-muted">
        This page does not exist, or you may not have access to it. Check the link, or use one of these.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-md bg-burgundy px-5 text-sm font-medium text-white hover:opacity-90">Go to home</Link>
        
      </div>
    </div>
  );
}
