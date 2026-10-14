import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { RELEASES } from "@/lib/release/notes";
import { T } from "@/components/domain/t";
import { MoreDetails } from "@/components/domain/more-details";

export const metadata: Metadata = { title: "What's new" };

function ReleaseSections({ release }: { release: (typeof RELEASES)[number] }) {
  return (
    <>
      {release.sections.map((section) => (
        <section key={section.heading} className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-semibold text-ink">{section.heading}</h3>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-ink">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Release notes: what changed since the last version (U9). The same entries are in CHANGELOG.md. */
export default async function WhatsNewPage() {
  await requireSession();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink"><T>What&apos;s new</T></h1>
        <p className="mt-1 text-sm text-muted"><T>Changes to QMP Inspect, newest first.</T></p>
      </header>

      {RELEASES.map((release, releaseIndex) => (
        <article key={release.version} className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{release.version}</h2>
            <p className="text-xs text-muted"><T>Up to</T> {release.date}</p>
            <p className="mt-2 text-sm text-ink">{release.summary}</p>
          </div>
          {releaseIndex === 0 ? (
            <ReleaseSections release={release} />
          ) : (
            <MoreDetails bare label="Show changes" className="mt-0">
              <div className="space-y-4"><ReleaseSections release={release} /></div>
            </MoreDetails>
          )}
        </article>
      ))}
    </div>
  );
}
