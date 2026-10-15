import Link from "next/link";
import { T } from "@/components/domain/t";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto mt-10 w-full max-w-md rounded-lg border border-border bg-surface p-5 text-center shadow-xs sm:p-8">
      <p className="text-4xl font-semibold text-muted" aria-hidden="true">404</p>
      <h1 className="mt-2 text-xl font-semibold text-ink"><T>Page not found</T></h1>
      <p className="mt-2 text-sm text-muted">
        <T>This page does not exist, or you may not have access to it. Check the link, or use one of these.</T>
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link href="/inspect" className={buttonVariants()}><T>Dashboard</T></Link>
        <Link href="/inspect/projects" className={buttonVariants({ variant: "outline" })}><T>Projects</T></Link>
        <Link href="/inspect/guide" className={buttonVariants({ variant: "outline" })}><T>Guide</T></Link>
      </div>
    </div>
  );
}
