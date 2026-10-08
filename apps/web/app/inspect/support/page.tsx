import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { SUPPORT_EMAIL_PLACEHOLDER, getSupportEmail } from "@/lib/support/contact";

export const metadata: Metadata = { title: "Help and support" };

const REPORT_STEPS = [
  "Say what you were trying to do and what happened instead (an exact error message helps most).",
  "Include the page address (the URL in your browser) and roughly when it happened.",
  "If the page showed an Error ID, quote it exactly.",
  "Say which project, record number (for example the ITP, IRN or NCR number) and your role. Do not send passwords.",
  "A screenshot helps. Please hide anything that is not part of the problem.",
];

/** Where to get help: the support contact (from NEXT_PUBLIC_SUPPORT_EMAIL), the guide and how to report an issue (U8). */
export default async function SupportPage() {
  await requireSession();
  const email = getSupportEmail();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Help and support</h1>
        <p className="mt-1 text-sm text-muted">Where to find answers and who to contact.</p>
      </header>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-ink">Contact support</h2>
        {email ? (
          <p className="mt-2 text-sm text-ink">
            Email{" "}
            <a className="font-medium text-burgundy underline" href={`mailto:${email}`}>
              {email}
            </a>
            .
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink">
            <mark className="rounded bg-warning/20 px-1">{SUPPORT_EMAIL_PLACEHOLDER}</mark>
            <span className="mt-1 block text-xs text-muted">
              The administrator of this deployment has not set a support address yet. Until then, ask your administrator.
            </span>
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-ink">Find an answer first</h2>
        <p className="mt-2 text-sm text-ink">
          The{" "}
          <Link href="/inspect/guide" className="font-medium text-burgundy underline">
            Guide
          </Link>{" "}
          explains each module (ITPs, inspections, IRNs, NCRs, the document vault, handover and registers), and the Ctrl+K search finds any page quickly. See{" "}
          <Link href="/inspect/whats-new" className="font-medium text-burgundy underline">
            What&apos;s new
          </Link>{" "}
          for recent changes.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-semibold text-ink">How to report an issue</h2>
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-ink">
          {REPORT_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>

      <p className="text-xs text-muted">
        <Link href="/privacy" className="underline">Privacy notice</Link> · <Link href="/terms" className="underline">Terms of use</Link>
      </p>
    </div>
  );
}
