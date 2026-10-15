"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportClientError } from "@/lib/observability/report-client-error";
import { Tx } from "@/components/domain/tx";
import { Button, buttonVariants } from "@/components/ui/button";

export default function PlatformError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto mt-10 max-w-md rounded-lg border border-border bg-surface p-6 text-center">
      <h1 className="text-xl font-semibold text-ink"><Tx>Something went wrong</Tx></h1>
      <p className="mt-2 text-sm text-muted">
        <Tx>We could not load this page. Your data is safe. Try again, or go back to the dashboard.</Tx>
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-muted">
          <Tx>Error ID:</Tx> <span className="font-mono">{error.digest}</span> <Tx>(quote this if you contact support; see</Tx> <Link href="/inspect/support" className="font-medium text-burgundy underline"><Tx>Help and support</Tx></Link>)
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          onClick={() => reset()}
          
        >
          <Tx>Try again</Tx>
        </Button>
        <a
          href="/platform"
          className={buttonVariants({ variant: "outline" })}
        >
          <Tx>Go to platform home</Tx>
        </a>
      </div>
    </div>
  );
}
