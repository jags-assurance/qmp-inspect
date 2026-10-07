/**
 * Certificate files are uploaded straight to storage by the browser under <project>/registers/<kind>/….
 * Only a clean path inside THIS project's registers folder is accepted: no "..", no empty or "." segments,
 * no backslashes or control characters, and it has to name a file below the folder.
 */
export function normaliseCertificatePath(projectId: string, raw: string): string | null {
  const path = raw.trim();
  if (!path) return null;
  const prefix = `${projectId}/registers/`;
  if (!path.startsWith(prefix) || path.length > 400) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  if (segments.length < 4) return null; // <project>/registers/<kind>/<file>
  return path;
}
