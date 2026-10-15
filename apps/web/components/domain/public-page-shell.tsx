import type { ReactNode } from "react";
import Link from "next/link";
import { SiteLinks } from "./site-links";
import { T } from "@/components/domain/t";

/** Plain page frame for the signed-out legal pages (privacy notice, terms of use). No session, no data. */
export function PublicPageShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6">
      <div className="-mx-4 mb-6 flex min-h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:-mx-6 sm:px-6">
        <span className="text-base font-semibold text-burgundy"><T>QMP Inspect</T></span>
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-burgundy hover:underline">
          <T>← Sign in</T>
        </Link>
      </div>
      <header className="mb-6 border-b border-border pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]">{title}</h1>
        <p className="mt-1 text-xs text-muted">{updated}</p>
      </header>
      <main className="space-y-6 text-sm leading-relaxed text-ink [&>p]:max-w-[70ch] [&_section>div>p]:max-w-[70ch] [&_li]:max-w-[70ch]">{children}</main>
      <footer className="mt-10 border-t border-border pt-4">
        <SiteLinks signedIn={false} />
      </footer>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-text-strong">{heading}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** A visible, unmistakable marker for text only the owner can supply. */
export function OwnerFill({ children }: { children: ReactNode }) {
  return <mark className="rounded bg-warning/20 px-1 text-ink"><T>[OWNER TO FILL:</T> {children}]</mark>;
}
