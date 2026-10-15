import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { SUPPORT_EMAIL_PLACEHOLDER, getSupportEmail } from "@/lib/support/contact";
import { T } from "@/components/domain/t";

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
        <h1 className="text-2xl font-semibold tracking-tight text-text-strong sm:text-[1.75rem]"><T>Help and support</T></h1>
        <p className="mt-1 text-sm text-muted"><T>Where to find answers and who to contact.</T></p>
      </header>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <h2 className="text-base font-semibold text-ink"><T>Contact support</T></h2>
        {email ? (
          <p className="mt-2 text-sm text-ink">
            <T>Email</T>{" "}
            <a className="font-medium text-burgundy underline" href={`mailto:${email}`}>
              {email}
            </a>
            .
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink">
            <mark className="rounded bg-warning/20 px-1">{SUPPORT_EMAIL_PLACEHOLDER}</mark>
            <span className="mt-1 block text-xs text-muted">
              <T>The administrator of this deployment has not set a support address yet. Until then, ask your administrator.</T>
            </span>
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <h2 className="text-base font-semibold text-ink"><T>Find an answer first</T></h2>
        <p className="mt-2 text-sm text-ink">
          <T>The</T>{" "}
          <Link href="/inspect/guide" className="font-medium text-burgundy underline">
            <T>Guide</T>
          </Link>{" "}
          <T>explains each module (ITPs, inspections, IRNs, NCRs, the document vault, handover and registers), and the Ctrl+K search finds any page quickly. See</T>{" "}
          <Link href="/inspect/whats-new" className="font-medium text-burgundy underline">
            <T>What&apos;s new</T>
          </Link>{" "}
          <T>for recent changes.</T>
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <h2 className="text-base font-semibold text-ink"><T>How to report an issue</T></h2>
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm text-ink">
          {REPORT_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>

      <p className="text-xs text-muted">
        <Link href="/privacy" className="underline"><T>Privacy notice</T></Link> · <Link href="/terms" className="underline"><T>Terms of use</T></Link>
      </p>
    </div>
  );
}
