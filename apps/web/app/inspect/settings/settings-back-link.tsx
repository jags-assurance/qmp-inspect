import Link from "next/link";
import { T } from "@/components/domain/t";

/**
 * The one back link every Settings page uses. Section pages go back to the Settings hub; drill-in
 * pages pass their parent list via `href`/`label`. Renders nothing when the view is embedded in
 * the hub workspace (the hub already provides navigation).
 */
export function SettingsBackLink({
  embedded,
  href = "/inspect/settings",
  label = "Settings",
}: {
  embedded?: boolean;
  href?: string;
  label?: string;
}) {
  if (embedded) return null;
  return (
    <Link href={href} className="mb-2 inline-flex min-h-8 items-center text-sm text-burgundy hover:underline">
      <T>← Back to</T> {label}
    </Link>
  );
}
