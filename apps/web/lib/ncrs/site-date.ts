// Calendar-day and timestamp handling in the site's timezone (not the server's). Plain module (no
// "use server") so server pages, routes and tests can share it. The zone defaults to the Gulf
// (UTC+4), which is where this product runs sites; override with NEXT_PUBLIC_SITE_TIMEZONE.

export function siteTimeZone(): string {
  return process.env.NEXT_PUBLIC_SITE_TIMEZONE || "Asia/Dubai";
}

/** Today's calendar date (YYYY-MM-DD) in the site timezone. */
export function siteToday(now: Date = new Date(), timeZone: string = siteTimeZone()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** "07/10/2026, 14:05" in the site timezone, regardless of where the server runs. */
export function formatSiteDateTime(iso: string, timeZone: string = siteTimeZone()): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { timeZone, dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** A date-only value (YYYY-MM-DD) shown as dd/mm/yyyy without any timezone shift. */
export function formatDateOnly(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}
