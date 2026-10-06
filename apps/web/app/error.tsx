"use client";

import { useEffect } from "react";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto mt-10 max-w-md rounded-lg border border-border bg-surface p-6 text-center">
      <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        We could not load this page. Your data is safe. Try again, or go back to the dashboard.
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-muted">
          Error ID: <span className="font-mono">{error.digest}</span> (quote this if you contact support)
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="min-h-11 rounded-md bg-burgundy px-5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
        >
          Try again
        </button>
        <a
          href="/"
          className="inline-flex min-h-11 items-center rounded-md border border-border px-5 text-sm font-medium text-ink hover:bg-off-white"
        >
          Go to home
        </a>
      </div>
    </div>
  );
}
