import Link from "next/link";
import { T } from "@/components/domain/t";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 text-center shadow-xs sm:p-8">
        <p className="text-4xl font-semibold text-muted" aria-hidden="true">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ink"><T>Page not found</T></h1>
        <p className="mt-2 text-sm text-muted">
          <T>This page does not exist, or you may not have access to it. Check the link, or use one of these.</T>
        </p>
        <div className="mt-5 flex justify-center">
          <Link href="/" className={buttonVariants()}><T>Go to home</T></Link>
        </div>
      </div>
    </main>
  );
}
