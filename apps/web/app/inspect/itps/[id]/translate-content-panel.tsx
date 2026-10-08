"use client";

import { useActionState } from "react";
import { translateItpContentAction, type TranslateItpContentState } from "@/lib/itps/actions";
import { isTranslationStale, type ItpTranslations } from "@/lib/itps/translations";
import { Tx } from "@/components/domain/tx";

const initialState: TranslateItpContentState = { error: null, translated: null, targetLanguage: null };

// French is the one translation offered. The server action still receives the language by name, so
// another can be added later by extending this single constant.
const TARGET_LANGUAGE = "French";

/**
 * R111: translates this ITP's own title + scope into a language the user picks, purely for
 * display alongside the original — never an edit of title/scope. The result is stored on the ITP
 * (itps.translations, D12) and shown from there afterwards. The caller only renders this when AI is
 * available for the ITP's organisation (key configured AND consent on).
 */
export function TranslateContentPanel({ itpId, revision, stored = {} }: { itpId: string; revision: number; stored?: ItpTranslations }) {
  const [state, formAction, pending] = useActionState(translateItpContentAction, initialState);

  return (
    <div className="mt-3 rounded-md border border-border bg-off-white p-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="itp_id" value={itpId} />
        <input type="hidden" name="target_language" value={TARGET_LANGUAGE} />
        <p className="text-xs text-muted"><Tx>Show the title &amp; scope in French, alongside the original.</Tx></p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-off-white disabled:opacity-50"
        >
          {pending ? "Translating…" : "Translate to French"}
        </button>
      </form>

      {state.error && <p role="alert" className="mt-2 text-xs text-danger">{state.error}</p>}

      {Object.entries(stored).map(([language, t]) => (
        <div key={language} className="mt-3 rounded-md border border-border bg-surface p-3" data-testid="stored-translation">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {language} <Tx>translation (stored</Tx>{t.translated_at ? ` ${new Date(t.translated_at).toLocaleDateString("en-GB")}` : ""}
            {isTranslationStale(t, revision) ? " — from an earlier revision, translate again to refresh" : ""})
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{[t.title, t.scope].filter(Boolean).join("\n\n")}</p>
        </div>
      ))}

      {state.translated && (
        <div className="mt-3 rounded-md border border-border bg-surface p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {state.targetLanguage} <Tx>translation (</Tx>{state.stored ? "saved on the ITP" : "not saved"} <Tx>— original unchanged)</Tx>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{state.translated}</p>
        </div>
      )}
    </div>
  );
}
