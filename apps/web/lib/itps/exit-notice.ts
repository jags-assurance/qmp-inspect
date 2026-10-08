/** Text for the banner shown on a superseded / withdrawn ITP (D9): status, since when, why. */
export function describeItpExit(input: { status: string; reason: string | null | undefined; at: string | null | undefined }): { heading: string; reason: string } | null {
  if (input.status !== "superseded" && input.status !== "withdrawn") return null;
  const label = input.status === "superseded" ? "Superseded" : "Withdrawn";
  const since = input.at ? ` since ${new Date(input.at).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : "";
  return { heading: `${label} — read-only${since}`, reason: input.reason?.trim() || "No reason recorded." };
}
