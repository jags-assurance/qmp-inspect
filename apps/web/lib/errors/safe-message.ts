// Maps raw database / storage errors to messages that are safe to show a user (P14). The raw detail
// (table, constraint and policy names, SQL text, storage internals) is only logged server-side or in the
// browser console, never returned to the UI. Plain module: usable from server actions and client code.

interface ErrorLike {
  code?: string | null;
  message?: string | null;
  statusCode?: string | number | null;
}

/** Postgres RAISE EXCEPTION (P0001) text is written by our own functions for the user ("ITP must be
 *  approved before it can be accepted"), so it is passed through; anything else is replaced by `fallback`. */
export function safeDbMessage(error: ErrorLike | null | undefined, fallback: string, context?: string): string {
  if (!error) return fallback;
  if (error.code === "P0001" && error.message && error.message.length <= 300) return error.message;
  if (context) console.error(`[${context}]`, error.code ?? "", error.message ?? "");
  return fallback;
}

/** Storage upload failure -> a short, actionable message. The cause is classified, never echoed. */
export function safeStorageUploadMessage(error: ErrorLike | null | undefined): string {
  if (!error) return "Upload failed. Check your connection and try again.";
  const status = String(error.statusCode ?? "");
  const text = error.message ?? "";
  if (typeof console !== "undefined") console.error("[storage upload]", status, error.code ?? "", text);
  if (status === "413" || /exceed|too large|maximum allowed size|payload/i.test(text)) {
    return "The file is larger than the storage limit allows. Use a smaller file.";
  }
  if (status === "401" || status === "403" || /row-level security|not authorized|unauthorized|permission denied/i.test(text)) {
    return "You don't have permission to upload this file here.";
  }
  if (status === "415" || /mime type|not supported/i.test(text)) {
    return "This file type is not accepted.";
  }
  if (/failed to fetch|network|timeout|load failed/i.test(text)) {
    return "Upload failed. Check your connection and try again.";
  }
  return "Upload failed. Please try again.";
}
