/**
 * Which fields get the browser's spell check, auto-correct and capital-letter help. Free writing (descriptions, comments,
 * reasons, notes, titles, activity names) benefits; identifiers, emails, codes, numbers and passwords must never be
 * "corrected", so they are left alone.
 */
export type SpellAttrs = { spellcheck: "true" | "false"; autocorrect: "on" | "off"; autocapitalize: "sentences" | "words" | "none" };

const NEVER_CORRECT_TYPES = new Set(["email", "password", "number", "tel", "url", "search", "date", "datetime-local", "time", "month", "week", "color", "file", "hidden", "checkbox", "radio", "range"]);
/** Names that hold identifiers or machine values: a "correction" there would corrupt data. */
const CODE_LIKE = /(^|[_\-\s.[])(id|ids|email|e-?mail|password|pass|pwd|otp|pin|code|number|no|num|ref|reference|serial|tag|slug|url|uri|link|path|token|key|secret|barcode|qr|phone|tel|mobile|lat|latitude|lng|longitude|radius|hours|revision|rev|username|user)(\b|[_\-\s.\]])/i;
const NAME_LIKE = /(^|[_\-\s.[])(name|title|company|organi[sz]ation|party|locations?|zones?|area|equipment|instrument|supplier|manufacturer|welder)(\b|[_\-\s.\]])/i;

export function spellAttrsFor(el: { tagName: string; type?: string; name?: string; id?: string; dataset?: Record<string, string | undefined> }): SpellAttrs | null {
  if (el.dataset?.noSpell !== undefined) return null;
  const tag = el.tagName.toLowerCase();
  const type = (el.type ?? "").toLowerCase();
  if (tag !== "textarea" && tag !== "input") return null;
  if (tag === "input" && type !== "" && type !== "text") return null;
  if (NEVER_CORRECT_TYPES.has(type)) return null;
  const label = `${el.name ?? ""} ${el.id ?? ""}`;
  if (CODE_LIKE.test(label)) return null;
  // Short names: underline mistakes but never silently rewrite someone's name.
  if (NAME_LIKE.test(label)) return { spellcheck: "true", autocorrect: "off", autocapitalize: "words" };
  return { spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" };
}
