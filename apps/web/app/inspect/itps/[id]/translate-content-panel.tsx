"use client";

import { useActionState } from "react";
import { translateItpContentAction, type TranslateItpContentState } from "@/lib/itps/actions";

const initialState: TranslateItpContentState = { error: null, translated: null, targetLanguage: null };

// A deliberately short, honest list — whatever Gemini actually produces for these is what ships,
// no "supports 40 languages" claim. The free-text option lets a user ask for anything else the
// model can plausibly handle without this app pretending to enumerate every language it supports.
const LANGUAGE_OPTIONS = [
  "Spanish",
  "French",
  "Portuguese",
  "Arabic",
  "Hindi",
  "Mandarin Chinese",
  "German",
  "Italian",
  "Russian",
  "Japanese",
];

/**
 * R111: translates this ITP's own title + scope into a language the user picks, purely for
 * display alongside the original — never an edit, never written back to the ITP. Gated by the
 * caller passing aiConfigured (see the ITP detail page's isAiConfigured() check) so the button
 * doesn't render at all on a deployment with no AI key, matching R43's pattern everywhere else.
 */
export function TranslateContentPanel({ itpId }: { itpId: string }) {
  const [state, formAction, pending] = useActionState(translateItpContentAction, initialState);

  return (
    <div className="mt-3 rounded-md border border-border bg-off-white p-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="itp_id" value={itpId} />
        <div>
          <label htmlFor="target_language" className="block text-xs text-muted">
            Translate title &amp; scope to
          </label>
          <select
            id="target_language"
            name="target_language"
            defaultValue={LANGUAGE_OPTIONS[0]}
            className="mt-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          >
            {LANGUAGE_OPTIONS.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-off-white disabled:opacity-50"
        >
          {pending ? "Translating…" : "Translate"}
        </button>
      </form>

      {state.error && <p className="mt-2 text-xs text-danger">{state.error}</p>}

      {state.translated && (
        <div className="mt-3 rounded-md border border-border bg-surface p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {state.targetLanguage} translation (display only — original unchanged)
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{state.translated}</p>
        </div>
      )}
    </div>
  );
}
