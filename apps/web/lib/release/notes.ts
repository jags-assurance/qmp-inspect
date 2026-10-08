// Release notes shown at /inspect/whats-new. CHANGELOG.md at the repo root carries the same entries in
// the same order: edit both together. Derived from `git log` on dev and docs/fixes/REMAINING.md.

export type ReleaseSection = "New" | "Improved" | "Fixed and secured" | "For administrators";

export interface ReleaseEntry {
  version: string;
  /** ISO date of the last change included. */
  date: string;
  summary: string;
  sections: { heading: ReleaseSection; items: string[] }[];
}

export const RELEASES: ReleaseEntry[] = [
  {
    // [OWNER TO FILL: release version number once the release is tagged]
    version: "October 2026 release (on dev, not yet tagged)",
    date: "2026-10-08",
    summary:
      "Reviewer comments, bulk IRN issue, audit-trail export, per-project report packs, an Arabic interface for the main screens, and a round of security and reliability fixes.",
    sections: [
      {
        heading: "New",
        items: [
          "Reviewer comment threads on completed inspections: post, reply and resolve.",
          "Bulk IRN issue: issue up to 50 release notices at once, with a result for each.",
          "Project audit-trail export as CSV or PDF.",
          "Per-project weekly and monthly report packs, filed into each project's vault.",
          "Admin alert when a background job fails for good (sent once per job).",
          "Optional two-step sign-in with an authenticator app (when enabled by the administrator).",
          "Arabic interface for sign-in, dashboards, the project list and shared tables, with right-to-left layout.",
          "iPhone HEIC photos are converted to JPEG in the browser when the browser cannot show them.",
          "Orphaned photo review screen, seat-limit overrides with a reason, and a PDF integrity seal on certificates and IRNs.",
          "Document retention rules that flag old documents for review (nothing is deleted).",
          "Privacy notice, terms of use with a one-time acceptance banner, a Help and support page and this What's new page.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "Faster pages: fewer database round trips per request, lighter statistics on the NCR and Observation registers, and calmer live refresh.",
          "Long lists load in windows with a Load more link; phone-friendly card layout for plain tables.",
          "Loading skeletons on detail, list and form pages.",
          "Closed projects show a Closed badge in the project list.",
          "Clearer messages for seat limits and for failed loads.",
        ],
      },
      {
        heading: "Fixed and secured",
        items: [
          "Inspectors can no longer update projects; non-admins are limited to the project details fields.",
          "Duplicate NCRs and observations from an offline retry are blocked in the database.",
          "Only one approved vault copy per document reference; approving a new revision retires the old one in one step.",
          "A database limit on active parties per type, matching the app.",
          "Offline checklist answers: three conflict cases fixed (baseline, queue order, synced baseline).",
          "Internal-only database helper functions are no longer callable by signed-in users.",
          "The content security policy is now enforced (set CSP_REPORT_ONLY=1 to revert without a code change).",
          "Updated Next.js and patched transitive dependencies (22 audit findings reduced to 2; see docs/RISK_ACCEPTANCE.md).",
        ],
      },
      {
        heading: "For administrators",
        items: [
          "Twelve new database migrations (20261118 to 20261124) and the terms-acceptance migration 20261128000100 are listed in docs/fixes/REMAINING.md; the app works before they are applied.",
          "Redeploy the Railway worker for failed-job alerts, per-project packs and the audit-trail PDF.",
          "New operations documents: rollback plan, incident response, data subject requests, subprocessors, privacy notice and risk register under docs/.",
        ],
      },
    ],
  },
];

export const LATEST_RELEASE = RELEASES[0];
