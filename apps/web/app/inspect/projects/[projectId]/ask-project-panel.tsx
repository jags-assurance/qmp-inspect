"use client";

import { useActionState, useState } from "react";
import { askProjectQuestionAction, type AskProjectQuestionState } from "@/lib/projects/actions";

const initialState: AskProjectQuestionState = { error: null, answer: null, question: null };

interface Exchange {
  question: string;
  answer: string;
}

/**
 * R111: "Ask your project" — a chat-style Q&A box scoped to this one project. Each question is
 * answered fresh from this project's own real, freshly-assembled context (see
 * askProjectQuestionAction in lib/projects/actions.ts) — not a stored conversation history sent
 * back to the model, so there's nothing here for a prior turn to poison. Only rendered when
 * isAiConfigured() is true (see the project hub page), matching R43's pattern everywhere else.
 */
export function AskProjectPanel({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(askProjectQuestionAction, initialState);
  const [history, setHistory] = useState<Exchange[]>([]);
  const [inputKey, setInputKey] = useState(0);

  const [appliedState, setAppliedState] = useState(state);
  if (state !== appliedState) {
    setAppliedState(state);
    if (state.answer !== null && state.question !== null) {
      setHistory((h) => [...h, { question: state.question!, answer: state.answer! }]);
      setInputKey((k) => k + 1);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-border bg-surface p-5">
      <h2 className="font-medium text-ink">Ask your project</h2>
      <p className="mt-1 text-sm text-muted">
        Ask a question about this project — the answer is grounded in its own ITPs, open NCRs and recent inspection records.
      </p>

      {history.length > 0 && (
        <div className="mt-4 space-y-3">
          {history.map((ex, i) => (
            <div key={i} className="rounded-md border border-border bg-off-white p-3">
              <p className="text-sm font-medium text-ink">Q: {ex.question}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{ex.answer}</p>
            </div>
          ))}
        </div>
      )}

      <form key={inputKey} action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="project_id" value={projectId} />
        <div className="min-w-[240px] flex-1">
          <label htmlFor="question" className="block text-xs text-muted">
            Your question
          </label>
          <input
            id="question"
            name="question"
            type="text"
            required
            placeholder="e.g. What open NCRs are still blocking handover?"
            className="mt-1 w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-burgundy px-3 py-2 text-xs font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
        >
          {pending ? "Asking…" : "Ask"}
        </button>
      </form>

      {state.error && <p className="mt-2 text-xs text-danger">{state.error}</p>}
    </div>
  );
}
