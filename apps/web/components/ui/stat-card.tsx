"use client";

import type { ReactNode } from "react";
import { StatTile } from "@/components/ui/stat-tile";

/**
 * Kept for existing call sites: StatCard is now StatTile (same props, new look). New code should
 * import StatTile / StatGrid from "@/components/ui/stat-tile".
 */
export function StatCard({
  label,
  value,
  icon,
  href,
  caption,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Optional destination: turns the tile into a real link to the list the count represents. */
  href?: string;
  /** Optional small line under the value, e.g. a sample-size note. */
  caption?: ReactNode;
}) {
  return <StatTile label={label} value={value} icon={icon} href={href} caption={caption} />;
}
