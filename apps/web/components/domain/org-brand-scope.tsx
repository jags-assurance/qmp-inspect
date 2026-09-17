import type { ReactNode } from "react";
import { orgBrandStyle, type OrgBrandColors } from "@/lib/branding/org-brand";

/**
 * Wraps a page (or section) whose org context is known server-side (e.g. a project's
 * organization_id) so its burgundy/gold utilities pick up that organisation's brand colors
 * instead of the default palette. See lib/branding/org-brand.ts for how the override works.
 */
export function OrgBrandScope({
  colors,
  children,
}: {
  colors: OrgBrandColors | null | undefined;
  children: ReactNode;
}) {
  return <div style={orgBrandStyle(colors)}>{children}</div>;
}
