import type { Metadata } from "next";
import { LegalSection, OwnerFill, PublicPageShell } from "@/components/domain/public-page-shell";
import { PERSONAL_DATA, SUBPROCESSOR_SUMMARY, USER_RIGHTS } from "@/lib/legal/privacy-data";
import { SUPPORT_EMAIL_PLACEHOLDER, getSupportEmail } from "@/lib/support/contact";

// Public (signed-out) route: listed in lib/auth/public-paths.ts. Static content, no user data.
// Mirrors docs/PRIVACY_NOTICE.md; edit both together.
export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  const email = getSupportEmail();
  return (
    <PublicPageShell title="Privacy notice" updated="Draft for owner and legal review. Last updated 2026-10-08.">
      <p>
        This notice explains what personal data QMP Inspect keeps about the people who use it, why, who else handles it, and how to
        exercise your rights. The service is operated by <OwnerFill>legal entity name and registered address</OwnerFill>.
      </p>

      <LegalSection heading="What we keep, why, and for how long">
        <div className="overflow-x-auto rounded-lg border border-border bg-surface" role="region" aria-label="What we keep, why, and for how long" tabIndex={0}>
          <table className="w-full min-w-[40rem] text-start text-xs md:text-sm">
            <thead className="bg-off-white text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">Data</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">What it includes</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">Why</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">How long</th>
              </tr>
            </thead>
            <tbody>
              {PERSONAL_DATA.map((row) => (
                <tr key={row.category} className="border-t border-border align-top">
                  <th scope="row" className="px-3 py-2 text-start font-medium text-ink">{row.category}</th>
                  <td className="px-3 py-2">{row.what}</td>
                  <td className="px-3 py-2">{row.purpose}</td>
                  <td className="px-3 py-2">{row.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Organisations can also set a document retention period under Settings. It only flags old vault documents for an administrator
          to review; it never deletes or changes a document.
        </p>
      </LegalSection>

      <LegalSection heading="Who else handles your data">
        <ul className="list-disc space-y-1 ps-5">
          {SUBPROCESSOR_SUMMARY.map((s) => (
            <li key={s.name}>
              <span className="font-medium">{s.name}</span>: {s.purpose}
            </li>
          ))}
        </ul>
        <p>
          Your data is not sold. Data location and transfer terms: <OwnerFill>hosting regions and transfer mechanism</OwnerFill>.
        </p>
      </LegalSection>

      <LegalSection heading="Legal basis">
        <p>
          <OwnerFill>legal basis for each purpose, e.g. contract, legitimate interest, legal obligation</OwnerFill>
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <ul className="list-disc space-y-1 ps-5">
          {USER_RIGHTS.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p>
          To make a request, contact <OwnerFill>data protection contact name and role</OwnerFill> at{" "}
          {email ? <a className="text-burgundy underline" href={`mailto:${email}`}>{email}</a> : <OwnerFill>{SUPPORT_EMAIL_PLACEHOLDER}</OwnerFill>}.
          We aim to respond within <OwnerFill>response time, e.g. 30 days</OwnerFill>.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          The app uses only the cookies it needs to keep you signed in, enforce session limits and remember your language. It does not use
          advertising or analytics cookies.
        </p>
      </LegalSection>
    </PublicPageShell>
  );
}
