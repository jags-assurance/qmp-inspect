"use client";

import { useActionState, useState } from "react";
import {
  createItpFromDraftAction,
  generateItpDraftAction,
  type CreateItpFromDraftState,
  type GenerateItpDraftState,
} from "@/lib/itps/ai-draft-actions";
import type { ItpDraftResult } from "@/lib/ai/provider";
import { Button } from "@/components/ui/button";

const INTERVENTION_LABEL: Record<"H" | "W" | "R" | "S", string> = {
  H: "Hold",
  W: "Witness",
  R: "Review",
  S: "Surveillance",
};

const EXTRACTION_LABEL: Record<string, string> = {
  done: "Ready",
  pending: "Processing…",
  empty: "No text found",
  unsupported: "File type not supported",
  failed: "Could not be read",
};

const createInitialState: CreateItpFromDraftState = { error: null };
const genInitialState: GenerateItpDraftState = { error: null, draft: null, projectParties: [] };

/** A vault document this user can pick as real source material for generation. */
export interface VaultDocumentOption {
  id: string;
  projectId: string;
  folderName: string;
  title: string;
  notes: string | null;
  documentNumber: string | null;
  documentReference: string | null;
  revision: string;
  /** 'pending' | 'done' | 'empty' | 'unsupported' | 'failed' — only 'done' has usable extracted text. */
  extractionStatus: string;
}

/**
 * Third "start an ITP" option: pick the actual requirement documents attached in this project's
 * vault (specs, standards, method statements — whatever covers the disciplines involved), get an
 * AI-generated draft grounded in their real text back, review and edit every field, optionally
 * regenerate with feedback, then confirm. Nothing is written to the database until the final
 * "Create ITP from this draft" submit — the draft returned by generateItpDraftAction is held only
 * in this component's local state (mirrored into an editable copy) until then.
 */
export function NewItpFromAiForm({
  projects,
  vaultDocuments,
  disciplines,
}: {
  projects: { id: string; project_number: string; name: string }[];
  vaultDocuments: VaultDocumentOption[];
  disciplines: { code: string; name: string }[];
}) {
  const [genState, genFormAction, genPending] = useActionState(generateItpDraftAction, genInitialState);
  const [draft, setDraft] = useState<ItpDraftResult | null>(null);
  const [projectParties, setProjectParties] = useState<GenerateItpDraftState["projectParties"]>([]);
  const [projectId, setProjectId] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  const projectVaultDocuments = vaultDocuments.filter((d) => d.projectId === projectId);

  function toggleDoc(docId: string) {
    setSelectedDocIds((ids) => (ids.includes(docId) ? ids.filter((id) => id !== docId) : [...ids, docId]));
  }

  // Derives the editable draft copy from a fresh generateItpDraftAction result during render
  // (React's documented "adjust state while rendering" pattern) rather than in a useEffect — this
  // avoids the extra commit-then-effect render pass for what is really just "seed local state from
  // a new action result". Also covers the "regenerate with feedback" case below, which reuses the
  // same genFormAction and simply overwrites the local draft with the new result.
  const [appliedGenState, setAppliedGenState] = useState(genState);
  if (genState !== appliedGenState) {
    setAppliedGenState(genState);
    if (genState.draft) {
      setDraft(genState.draft);
      setProjectParties(genState.projectParties);
      setFeedback("");
    }
  }

  const [createState, createFormAction, createPending] = useActionState(
    createItpFromDraftAction,
    createInitialState
  );

  if (!draft) {
    return (
      <form action={genFormAction} className="mt-6 space-y-4">
        <div>
          <label htmlFor="ai_project_id" className="block text-sm font-medium text-ink">
            Project
          </label>
          <select
            id="ai_project_id"
            name="project_id"
            required
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setSelectedDocIds([]);
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value="">Select…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.name}
              </option>
            ))}
          </select>
        </div>

        {projectId && (
          <div>
            <p className="block text-sm font-medium text-ink">Requirement documents from the vault</p>
            <p className="mt-1 text-xs text-muted">
              Pick everything relevant — specs, standards, method statements, drawings notes. The AI
              reads their actual text and covers every discipline they touch in one draft.
            </p>
            {projectVaultDocuments.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-border bg-off-white p-3 text-xs text-muted">
                No documents in this project&apos;s vault yet — upload specs/standards under Document
                Vault first, or describe the scope below instead.
              </p>
            ) : (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {projectVaultDocuments.map((doc) => {
                  const usable = doc.extractionStatus === "done";
                  return (
                    <li key={doc.id} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-off-white">
                      <input
                        type="checkbox"
                        id={`doc_${doc.id}`}
                        name="vault_document_ids"
                        value={doc.id}
                        checked={selectedDocIds.includes(doc.id)}
                        onChange={() => toggleDoc(doc.id)}
                        disabled={!usable}
                        className="mt-0.5"
                      />
                      <label htmlFor={`doc_${doc.id}`} className="flex-1 text-sm">
                        <span className={usable ? "text-ink" : "text-muted"}>
                          {doc.documentNumber ? `${doc.documentNumber} — ` : ""}
                          {doc.title}
                        </span>
                        <span className="ml-2 text-xs text-muted">
                          {doc.folderName} · rev {doc.revision} ·{" "}
                          <span className={usable ? "text-success" : "text-muted"}>
                            {EXTRACTION_LABEL[doc.extractionStatus] ?? doc.extractionStatus}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div>
          <label htmlFor="additional_instructions" className="block text-sm font-medium text-ink">
            Additional instructions <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="additional_instructions"
            name="additional_instructions"
            rows={4}
            value={additionalInstructions}
            onChange={(e) => setAdditionalInstructions(e.target.value)}
            placeholder="Anything the documents don't cover, or a focus to apply — e.g. &quot;electrical works only&quot;, or paste extra scope text if you have no document to attach."
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
          <p className="mt-1 text-xs text-muted">
            The AI drafts sections, activities, references, acceptance criteria and suggested
            intervention levels per party for you to review and edit below — nothing is created
            until you confirm.
          </p>
        </div>

        {genState.error && <p className="text-sm text-danger">{genState.error}</p>}

        <Button type="submit" disabled={genPending}>
          {genPending ? "Generating…" : "Generate draft"}
        </Button>
      </form>
    );
  }

  const project = projects.find((p) => p.id === projectId);

  function updateSectionTitle(sectionIdx: number, title: string) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, i) => (i === sectionIdx ? { ...s, title } : s));
      return { sections };
    });
  }

  function updateItem(
    sectionIdx: number,
    itemIdx: number,
    patch: Partial<ItpDraftResult["sections"][number]["items"][number]>
  ) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        return { ...s, items: s.items.map((it, ii) => (ii === itemIdx ? { ...it, ...patch } : it)) };
      });
      return { sections };
    });
  }

  function removeItem(sectionIdx: number, itemIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        return { ...s, items: s.items.filter((_, ii) => ii !== itemIdx) };
      });
      return { sections };
    });
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-md border border-border bg-off-white p-3">
        <p className="text-sm text-muted">
          Draft for <span className="font-medium text-ink">{project?.name ?? "the selected project"}</span> —
          edit anything below directly, or if the draft isn&apos;t right, describe what to change and
          regenerate instead of editing by hand.
        </p>
        <form action={genFormAction} className="mt-3 space-y-2">
          <input type="hidden" name="project_id" value={projectId} />
          {selectedDocIds.map((id) => (
            <input key={id} type="hidden" name="vault_document_ids" value={id} />
          ))}
          <input
            type="hidden"
            name="additional_instructions"
            value={
              feedback
                ? [additionalInstructions, `Feedback on the previous draft — apply this: ${feedback}`]
                    .filter(Boolean)
                    .join("\n\n")
                : additionalInstructions
            }
          />
          <textarea
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. &quot;too many Hold points on Voltway&quot;, &quot;missing a weld inspection step&quot;, &quot;split testing into two activities&quot;…"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={genPending || !feedback.trim()}
              className="rounded-md border border-burgundy px-3 py-1.5 text-xs font-medium text-burgundy hover:bg-burgundy/5 disabled:opacity-50"
            >
              {genPending ? "Regenerating…" : "Regenerate with this feedback"}
            </button>
            {genState.error && <p className="text-xs text-danger">{genState.error}</p>}
          </div>
        </form>
      </div>

      <form action={createFormAction} className="space-y-6">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="draft_json" value={JSON.stringify(draft)} readOnly />

        <div>
          <label htmlFor="ai_itp_number" className="block text-sm font-medium text-ink">
            ITP number
          </label>
          <input
            id="ai_itp_number"
            name="itp_number"
            required
            placeholder="e.g. MER-JAGS-ITP-002"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy doc-id"
          />
        </div>

        <div>
          <label htmlFor="ai_title" className="block text-sm font-medium text-ink">
            Title
          </label>
          <input
            id="ai_title"
            name="title"
            required
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>

        <div>
          <label htmlFor="ai_applicable_standard" className="block text-sm font-medium text-ink">
            Applicable standard
          </label>
          <input
            id="ai_applicable_standard"
            name="applicable_standard"
            placeholder="e.g. IEC 61439"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>

        <div className="space-y-4">
          {draft.sections.map((section, sectionIdx) => (
            <div key={sectionIdx} className="rounded-md border border-border p-3">
              <input
                value={section.title}
                onChange={(e) => updateSectionTitle(sectionIdx, e.target.value)}
                className="w-full rounded border border-border bg-surface px-2 py-1 text-sm font-medium text-ink"
              />
              <div className="mt-3 space-y-3">
                {section.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="rounded border border-border bg-off-white p-2 text-sm">
                    <div className="grid grid-cols-[80px_1fr] gap-2">
                      <input
                        value={item.itemNumber}
                        onChange={(e) => updateItem(sectionIdx, itemIdx, { itemNumber: e.target.value })}
                        className="rounded border border-border bg-surface px-2 py-1 doc-id"
                        placeholder="Item #"
                      />
                      <input
                        value={item.activity}
                        onChange={(e) => updateItem(sectionIdx, itemIdx, { activity: e.target.value })}
                        className="rounded border border-border bg-surface px-2 py-1"
                        placeholder="Activity"
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        value={item.referenceSpec}
                        onChange={(e) => updateItem(sectionIdx, itemIdx, { referenceSpec: e.target.value })}
                        className="rounded border border-border bg-surface px-2 py-1 text-xs"
                        placeholder="Reference (spec clause / standard)"
                      />
                      <select
                        value={item.disciplineCode ?? ""}
                        onChange={(e) =>
                          updateItem(sectionIdx, itemIdx, { disciplineCode: e.target.value || null })
                        }
                        className="rounded border border-border bg-surface px-2 py-1 text-xs"
                      >
                        <option value="">No discipline</option>
                        {disciplines.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <textarea
                      value={item.acceptanceCriteria}
                      onChange={(e) => updateItem(sectionIdx, itemIdx, { acceptanceCriteria: e.target.value })}
                      rows={2}
                      className="mt-2 w-full rounded border border-border bg-surface px-2 py-1"
                      placeholder="Acceptance criteria"
                    />

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        value={item.method}
                        onChange={(e) => updateItem(sectionIdx, itemIdx, { method: e.target.value })}
                        className="rounded border border-border bg-surface px-2 py-1 text-xs"
                        placeholder="Method (e.g. Megger test)"
                      />
                      <input
                        value={item.frequency}
                        onChange={(e) => updateItem(sectionIdx, itemIdx, { frequency: e.target.value })}
                        className="rounded border border-border bg-surface px-2 py-1 text-xs"
                        placeholder="Frequency (e.g. Each circuit)"
                      />
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <select
                        value={item.evidenceType}
                        onChange={(e) =>
                          updateItem(sectionIdx, itemIdx, { evidenceType: Number(e.target.value) as 1 | 2 | 3 })
                        }
                        className="rounded border border-border bg-surface px-2 py-1 text-xs"
                      >
                        <option value={1}>Checklist</option>
                        <option value={2}>Document upload</option>
                        <option value={3}>Measurement record</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeItem(sectionIdx, itemIdx)}
                        className="text-xs text-danger hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    {item.suggestedInterventions.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-muted">
                        {item.suggestedInterventions.map((si, siIdx) => {
                          const party = projectParties.find((p) => p.id === si.projectPartyId);
                          return (
                            <li key={siIdx}>
                              <span className="font-medium text-ink">{party?.name ?? "Unknown party"}</span>:{" "}
                              {INTERVENTION_LABEL[si.intervention]} — {si.reason}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {createState.error && <p className="text-sm text-danger">{createState.error}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={createPending}>
            {createPending ? "Creating…" : "Create ITP from this draft"}
          </Button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded-md border border-border px-3 py-2 text-sm text-ink hover:bg-off-white"
          >
            Discard draft
          </button>
        </div>
      </form>
    </div>
  );
}
