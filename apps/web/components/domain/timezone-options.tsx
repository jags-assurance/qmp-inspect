/** <datalist> of IANA time zones for a free-text zone input (list="project-timezones"). The server
 *  action validates what is typed, so this is only a suggestion list. */
export function TimeZoneOptions() {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = ["Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Europe/London", "America/New_York", "Australia/Sydney"];
  }
  return (
    <datalist id="project-timezones">
      {[...new Set(["UTC", ...zones])].map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  );
}
