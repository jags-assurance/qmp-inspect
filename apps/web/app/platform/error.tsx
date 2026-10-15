"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportClientError } from "@/lib/observability/report-client-error";
import { ErrorIdChip } from "@/components/domain/error-id-chip";
import { Tx } from "@/components/domain/tx";
import { Button, buttonVariants } from "@/components/ui/button";

export default function PlatformError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto mt-10 w-full max-w-md rounded-lg border border-border bg-surface p-5 text-center shadow-xs sm:p-8">
      <h1 className="text-xl font-semibold text-ink"><Tx>Something went wrong</Tx></h1>
      <p className="mt-2 text-sm text-muted">
        <Tx>We could not load this page. Your data is safe. Try again, or go back to the dashboard.</Tx>
      </p>
      {error.digest && (
        <div className="mt-4 flex flex-col items-center gap-1">
          <ErrorIdChip id={error.digest} />
          <p className="text-xs text-muted">
            <Tx>Quote this if you contact support; see</Tx>{" "}
            <Link href="/inspect/support" className="font-medium text-burgundy underline"><Tx>Help and support</Tx></Link>
          </p>
        </div>
      )}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
        <a href="/platform" className={buttonVariants({ variant: "outline" })}>
          <Tx>Go to platform home</Tx>
        </a>
        <Button type="button" onClick={() => reset()}>
          <Tx>Try again</Tx>
        </Button>
      </div>
    </div>
  );
}
