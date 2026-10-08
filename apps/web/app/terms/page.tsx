import type { Metadata } from "next";
import Link from "next/link";
import { LegalSection, OwnerFill, PublicPageShell } from "@/components/domain/public-page-shell";
import { TERMS_VERSION } from "@/lib/terms/constants";

// Public (signed-out) route: listed in lib/auth/public-paths.ts. Generic wording only; the owner's
// legal review replaces every marked placeholder and sets the real TERMS_VERSION (lib/terms/constants.ts).
export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <PublicPageShell title="Terms of use" updated={`Draft for owner and legal review. Version ${TERMS_VERSION}.`}>
      <p>
        These terms apply to your use of QMP Inspect, operated by <OwnerFill>legal entity name and registered address</OwnerFill> (&quot;we&quot;).
        By using the service you agree to them. If your organisation has a separate signed agreement with us, that agreement
        prevails where the two differ.
      </p>

      <LegalSection heading="1. Your account">
        <p>
          Accounts are issued by an administrator. Keep your password private, do not share your login, and tell your administrator
          straight away if you think someone else has used it. Actions taken with your login are recorded against your name.
        </p>
      </LegalSection>

      <LegalSection heading="2. Acceptable use">
        <p>
          Use the service only for the quality and inspection work you are authorised to do. Do not try to access data you have not
          been given access to, interfere with the service, upload unlawful or harmful content, or enter information you know to be false
          in a quality record.
        </p>
      </LegalSection>

      <LegalSection heading="3. Records and your content">
        <p>
          Inspection records, sign-offs, approved documents and the audit trail are controlled quality records. Once signed or approved
          they are kept as history and corrected by a new revision, not erased. You are responsible for the accuracy of what you enter
          and upload, and you confirm you may share it.
        </p>
      </LegalSection>

      <LegalSection heading="4. AI assistance">
        <p>
          Where your organisation has switched on AI drafting, drafts are suggestions only. A qualified person must review and take
          responsibility for anything that is adopted into a record.
        </p>
      </LegalSection>

      <LegalSection heading="5. Availability and changes">
        <p>
          We work to keep the service available but do not promise it will be uninterrupted. We may change or withdraw features, and
          will update these terms and the version above when they change; you may be asked to accept the new version.
        </p>
      </LegalSection>

      <LegalSection heading="6. Liability">
        <p>
          <OwnerFill>limitation of liability and warranty wording from legal counsel</OwnerFill>
        </p>
      </LegalSection>

      <LegalSection heading="7. Privacy">
        <p>
          How we handle personal data is described in the <Link className="text-burgundy underline" href="/privacy">privacy notice</Link>.
        </p>
      </LegalSection>

      <LegalSection heading="8. Governing law and contact">
        <p>
          Governing law and courts: <OwnerFill>jurisdiction</OwnerFill>. Questions about these terms: use the Help and support page
          after signing in, or contact <OwnerFill>legal contact</OwnerFill>.
        </p>
      </LegalSection>
    </PublicPageShell>
  );
}
