/**
 * One small line icon per sidebar section, keyed by the nav item's own label text — so a collapsed
 * sidebar still reads as "which section is which" rather than a column of identical dots. A label
 * with no match (a future nav item added without updating this map) falls back to a plain dot rather
 * than breaking, since this is cosmetic, not load-bearing.
 */
import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

const ICONS: Record<string, (props: SVGProps<SVGSVGElement>) => React.ReactElement> = {
  "← JAGS Assurance": (p) => (
    <Icon {...p}>
      <circle cx="10" cy="10" r="7" />
      <path d="M11.5 7L8.5 10l3 3" />
    </Icon>
  ),
  Dashboard: (p) => (
    <Icon {...p}>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </Icon>
  ),
  "Start work": (p) => (
    <Icon {...p}>
      <path d="M6 3.5l9 6.5-9 6.5z" strokeLinejoin="round" />
    </Icon>
  ),
  Projects: (p) => (
    <Icon {...p}>
      <path d="M3 6.5a1 1 0 011-1h4l1.5 2H16a1 1 0 011 1V15a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
    </Icon>
  ),
  ITPs: (p) => (
    <Icon {...p}>
      <rect x="5" y="3" width="10" height="14" rx="1.5" />
      <path d="M7.5 7h5M7.5 10h5M7.5 13h3" />
    </Icon>
  ),
  NCRs: (p) => (
    <Icon {...p}>
      <path d="M10 3.5l7 12.5H3l7-12.5z" strokeLinejoin="round" />
      <path d="M10 8.5v3" />
      <circle cx="10" cy="13.5" r="0.75" fill="currentColor" stroke="none" />
    </Icon>
  ),
  Observations: (p) => (
    <Icon {...p}>
      <path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10z" />
      <circle cx="10" cy="10" r="2.25" />
    </Icon>
  ),
  "Standalone Assignments": (p) => (
    <Icon {...p}>
      <path d="M8 3h4M9 3v4.5L5.5 15a1.2 1.2 0 001 1.8h7a1.2 1.2 0 001-1.8L11 7.5V3" strokeLinejoin="round" />
    </Icon>
  ),
  "Document Vault": (p) => (
    <Icon {...p}>
      <rect x="4" y="8.5" width="12" height="8" rx="1.5" />
      <path d="M6.5 8.5V6a3.5 3.5 0 017 0v2.5" />
    </Icon>
  ),
  Handover: (p) => (
    <Icon {...p}>
      <path d="M3 10h11" />
      <path d="M10.5 6l3.5 4-3.5 4" strokeLinejoin="round" />
    </Icon>
  ),
  "Client Organisations": (p) => (
    <Icon {...p}>
      <rect x="4.5" y="3.5" width="8" height="13" rx="1" />
      <path d="M7 6.5h.01M10 6.5h.01M7 9.5h.01M10 9.5h.01M7 12.5h.01M10 12.5h.01" />
      <path d="M12.5 8.5H15a1 1 0 011 1v6.5h-3.5" />
    </Icon>
  ),
  "Master ITP Library": (p) => (
    <Icon {...p}>
      <path d="M4 4.5A1.5 1.5 0 015.5 3H10v14H5.5A1.5 1.5 0 014 15.5z" />
      <path d="M16 4.5A1.5 1.5 0 0014.5 3H10v14h4.5a1.5 1.5 0 001.5-1.5z" />
    </Icon>
  ),
  Numbering: (p) => (
    <Icon {...p}>
      <path d="M4 6.5h12M4 10h12M4 13.5h8" />
      <path d="M4 6.5v0" />
    </Icon>
  ),
  "Staff Access": (p) => (
    <Icon {...p}>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M2.5 16c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" />
      <path d="M13 8a2 2 0 100-4 2 2 0 000 4z" />
      <path d="M12.5 11.5c1.9.4 3.5 1.9 3.5 3.7" />
    </Icon>
  ),
};

const FALLBACK = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="2" fill="currentColor" stroke="none" />
  </Icon>
);

export function NavIcon({ label, className }: { label: string; className?: string }) {
  const Cmp = ICONS[label] ?? FALLBACK;
  return <Cmp className={className ?? "h-4 w-4 shrink-0"} />;
}
