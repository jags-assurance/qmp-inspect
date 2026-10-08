"use client";

import { useActionState } from "react";
import { translateItpContentAction, type TranslateItpContentState } from "@/lib/itps/actions";

const initialState: TranslateItpContentState = { error: null, translated: null, targetLanguage: null };

// French is the one translation offered. The server action still receives the language by name, so
// another can be added later by extending this single constant.
const TARGET_LANGUAGE = "French";

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
        <input type="hidden" name="target_language" value={TARGET_LANGUAGE} />
        <p className="text-xs text-muted">Show the title &amp; scope in French, alongside the original.</p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-off-white disabled:opacity-50"
        >
          {pending ? "Translating…" : "Translate to French"}
        </button>
      </form>

      {state.error && <p role="alert" className="mt-2 text-xs text-danger">{state.error}</p>}

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
