import type { ReactNode } from "react";
import Link from "next/link";
import { SiteLinks } from "./site-links";
import { T } from "@/components/domain/t";

/** Plain page frame for the signed-out legal pages (privacy notice, terms of use). No session, no data. */
export function PublicPageShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 border-b border-border pb-4">
        <Link href="/login" className="text-sm font-medium text-burgundy hover:underline">
          <T>← Sign in</T>
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-xs text-muted">{updated}</p>
      </header>
      <main className="space-y-6 text-sm leading-relaxed text-ink">{children}</main>
      <footer className="mt-10 border-t border-border pt-4">
        <SiteLinks signedIn={false} />
      </footer>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-ink">{heading}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** A visible, unmistakable marker for text only the owner can supply. */
export function OwnerFill({ children }: { children: ReactNode }) {
  return <mark className="rounded bg-warning/20 px-1 text-ink"><T>[OWNER TO FILL:</T> {children}]</mark>;
}
