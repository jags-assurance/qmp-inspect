import Link from "next/link";

/**
 * Small row of links shown in the app footer, on the sign-in page and on the public pages: help,
 * privacy, terms and release notes. `signedIn` switches the two signed-in-only destinations
 * (support, what's new) off for the signed-out pages, which only get the public ones.
 */
export function SiteLinks({ signedIn, className = "" }: { signedIn: boolean; className?: string }) {
  const link = "text-xs text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-burgundy";
  return (
    <nav aria-label="Help and legal" className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
      {signedIn && (
        <Link href="/inspect/support" className={link}>
          Help and support
        </Link>
      )}
      <Link href="/privacy" className={link}>
        Privacy notice
      </Link>
      <Link href="/terms" className={link}>
        Terms of use
      </Link>
      {signedIn && (
        <Link href="/inspect/whats-new" className={link}>
          What&apos;s new
        </Link>
      )}
    </nav>
  );
}
