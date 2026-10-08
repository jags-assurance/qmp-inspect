import Link from "next/link";
import { T } from "@/components/domain/t";

export default function NotFound() {
  return (
    <div className="mx-auto my-20 max-w-md rounded-lg border border-border bg-surface p-6 text-center">
      <h1 className="text-xl font-semibold text-ink"><T>Page not found</T></h1>
      <p className="mt-2 text-sm text-muted">
        <T>This page does not exist, or you may not have access to it. Check the link, or use one of these.</T>
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-md bg-burgundy px-5 text-sm font-medium text-white hover:opacity-90"><T>Go to home</T></Link>
        
      </div>
    </div>
  );
}
