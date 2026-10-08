import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { RELEASES } from "@/lib/release/notes";

export const metadata: Metadata = { title: "What's new" };

/** Release notes: what changed since the last version (U9). The same entries are in CHANGELOG.md. */
export default async function WhatsNewPage() {
  await requireSession();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-ink">What&apos;s new</h1>
        <p className="mt-1 text-sm text-muted">Changes to QMP Inspect, newest first.</p>
      </header>

      {RELEASES.map((release) => (
        <article key={release.version} className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{release.version}</h2>
            <p className="text-xs text-muted">Up to {release.date}</p>
            <p className="mt-2 text-sm text-ink">{release.summary}</p>
          </div>
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
        </article>
      ))}
    </div>
  );
}
