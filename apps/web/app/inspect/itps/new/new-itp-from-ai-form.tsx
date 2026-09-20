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

// The AI draft flow only ever suggests one of the four built-in codes (see
// AI_SUGGESTED_INTERVENTION_LEVELS in lib/ai/provider.ts) — a custom organisation-specific level
// isn't something the model has been told about, so this preview-only label map stays a plain
// fallback (falls back to the bare code for anything unrecognised) rather than an org-scoped lookup.
const INTERVENTION_LABEL: Record<string, string> = {
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
const genInitialState: GenerateItpDraftState = { error: null, draft: null, projectParties: [], aiLogId: null };

type CountMode = "auto" | "concise" | "standard" | "detailed" | "custom";

const COUNT_MODE_OPTIONS: { value: CountMode; label: string; hint: string }[] = [
  { value: "auto", label: "Let AI decide", hint: "Whatever the source material naturally supports." },
  { value: "concise", label: "Concise", hint: "~1–2 activities per section — the critical points only." },
  { value: "standard", label: "Standard", hint: "~3–4 activities per section — typical level of detail." },
  { value: "detailed", label: "Detailed", hint: "~5–7 activities per section — as thorough as the source allows." },
  { value: "custom", label: "Custom", hint: "Set an exact target number per section." },
];

/** Builds the extra instruction line the count control adds on top of the user's own free text. */
function countInstructionFor(mode: CountMode, customCount: string): string {
  switch (mode) {
    case "concise":
      return "Keep each section concise — aim for roughly 1-2 activities per section, covering only the most critical checks.";
    case "standard":
      return "Aim for a standard level of detail — roughly 3-4 activities per section.";
    case "detailed":
      return "Be thorough — aim for roughly 5-7 activities per section, covering as many distinct checks or tests as the source material supports.";
    case "custom": {
      const n = Number(customCount);
      return n > 0 ? `Aim for approximately ${n} activities in each section.` : "";
    }
    case "auto":
    default:
      return "";
  }
}

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
  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [countMode, setCountMode] = useState<CountMode>("auto");
  const [customCount, setCustomCount] = useState("4");

  const projectVaultDocuments = vaultDocuments.filter((d) => d.projectId === projectId);
  const disciplineNameByCode = new Map(disciplines.map((d) => [d.code, d.name]));

  function toggleDoc(docId: string) {
    setSelectedDocIds((ids) => (ids.includes(docId) ? ids.filter((id) => id !== docId) : [...ids, docId]));
  }

  function combinedInstructions(extra?: string): string {
    const countLine = countInstructionFor(countMode, customCount);
    return [countLine, additionalInstructions, extra].filter(Boolean).join("\n\n");
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
      setAiLogId(genState.aiLogId);
      setFeedback("");
    }
  }

  const [createState, createFormAction, createPending] = useActionState(
    createItpFromDraftAction,
    createInitialState
  );

  if (!draft) {
    return (
      <form action={genFormAction} className="mt-6 space-y-6">
        <div>
          <label htmlFor="ai_project_id" className="block text-sm font-semibold text-ink">
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
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-burgundy"
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
            <p className="block text-sm font-semibold text-ink">Requirement documents from the vault</p>
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
                    <li key={doc.id} className="flex items-start gap-2 rounded px-1.5 py-1.5 hover:bg-off-white">
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
                        {doc.extractionStatus === "unsupported" && (
                          <span className="mt-0.5 block text-xs text-muted">
                            Only PDF, Word (.docx), or plain text/.md can be read for AI generation —
                            re-upload this document as one of those to use it here.
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div>
          <p className="block text-sm font-semibold text-ink">Activities per section</p>
          <p className="mt-1 text-xs text-muted">
            How thorough each of the 4 sections should be — the AI still decides exactly which
            checks matter most, this just sets the target depth.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {COUNT_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCountMode(opt.value)}
                title={opt.hint}
                className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                  countMode === opt.value
                    ? "border-burgundy bg-burgundy text-white"
                    : "border-border bg-surface text-ink hover:bg-off-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {COUNT_MODE_OPTIONS.find((o) => o.value === countMode)?.hint}
          </p>
          {countMode === "custom" && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={20}
                value={customCount}
                onChange={(e) => setCustomCount(e.target.value)}
                className="w-24 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
              />
              <span className="text-xs text-muted">activities per section</span>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="additional_instructions_visible" className="block text-sm font-semibold text-ink">
            Additional instructions <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="additional_instructions_visible"
            rows={4}
            value={additionalInstructions}
            onChange={(e) => setAdditionalInstructions(e.target.value)}
            placeholder="Anything the documents don't cover, or a focus to apply — e.g. &quot;electrical works only&quot;, or paste extra scope text if you have no document to attach."
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-burgundy"
          />
          {/* Combines the count-mode instruction with the user's free text into the one field the
              server action actually reads — keeps the count control a first-class UI element instead
              of asking the user to type it themselves. */}
          <input type="hidden" name="additional_instructions" value={combinedInstructions()} />
          <p className="mt-1.5 text-xs text-muted">
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
  const totalActivities = draft.sections.reduce((sum, s) => sum + s.items.length, 0);

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

  // Manual "+ Add activity" for a section — lets the user top up a section themselves (e.g. after
  // narrowing the AI's count-mode target) rather than only ever being able to Remove or regenerate
  // the whole draft. Starts blank; the same field-level editors below fill it in.
  function addItem(sectionIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.map((s, si) => {
        if (si !== sectionIdx) return s;
        const nextNumber = `${sectionIdx + 1}.${s.items.length + 1}`;
        return {
          ...s,
          items: [
            ...s.items,
            {
              itemNumber: nextNumber,
              activity: "",
              referenceSpec: "",
              acceptanceCriteria: "",
              method: "",
              frequency: "",
              evidenceType: 1 as const,
              disciplineCode: null,
              suggestedInterventions: [],
            },
          ],
        };
      });
      return { sections };
    });
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-lg border border-border bg-off-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-muted">
            Draft for <span className="font-semibold text-ink">{project?.name ?? "the selected project"}</span>
          </p>
          <p className="text-xs text-muted">
            {draft.sections.length} sections · {totalActivities} activities total
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          Edit anything below directly, use <strong>+ Add activity</strong> to top up a section, or
          describe a change and regenerate the whole draft instead of editing by hand.
        </p>
        <form action={genFormAction} className="mt-3 space-y-2">
          <input type="hidden" name="project_id" value={projectId} />
          {selectedDocIds.map((id) => (
            <input key={id} type="hidden" name="vault_document_ids" value={id} />
          ))}
          <input type="hidden" name="additional_instructions" value={combinedInstructions(feedback ? `Feedback on the previous draft — apply this: ${feedback}` : undefined)} />
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
        <input type="hidden" name="ai_log_id" value={aiLogId ?? ""} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="ai_itp_number" className="block text-sm font-semibold text-ink">
              ITP number
            </label>
            <input
              id="ai_itp_number"
              name="itp_number"
              required
              placeholder="e.g. MER-JAGS-ITP-002"
              className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-burgundy doc-id"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="ai_title" className="block text-sm font-semibold text-ink">
              Title
            </label>
            <input
              id="ai_title"
              name="title"
              required
              className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-burgundy"
            />
          </div>
        </div>

        <div>
          <label htmlFor="ai_applicable_standard" className="block text-sm font-semibold text-ink">
            Applicable standard <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="ai_applicable_standard"
            name="applicable_standard"
            placeholder="e.g. IEC 61439"
            className="mt-1.5 w-full max-w-sm rounded-md border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-burgundy"
          />
        </div>

        <div className="space-y-5">
          {draft.sections.map((section, sectionIdx) => (
            <div key={sectionIdx} className="rounded-lg border border-border">
              <div className="flex items-center justify-between gap-3 rounded-t-lg border-b border-border bg-off-white px-3 py-2">
                <input
                  value={section.title}
                  onChange={(e) => updateSectionTitle(sectionIdx, e.target.value)}
                  aria-label={`Section ${sectionIdx + 1} title`}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-ink hover:border-border focus:border-burgundy focus:bg-surface focus:outline-none"
                />
                <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">
                  {section.items.length} {section.items.length === 1 ? "activity" : "activities"}
                </span>
              </div>

              <div className="space-y-3 p-3">
                {section.items.length === 0 && (
                  <p className="rounded-md border border-dashed border-border bg-off-white p-3 text-center text-xs text-muted">
                    No activities in this section yet.
                  </p>
                )}
                {section.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="rounded-md border border-border bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="doc-id rounded bg-off-white px-2 py-1 text-xs font-medium text-ink">
                        Item {item.itemNumber || `${sectionIdx + 1}.${itemIdx + 1}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(sectionIdx, itemIdx)}
                        className="text-xs font-medium text-danger hover:underline"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[80px_1fr]">
                      <div>
                        <label className="block text-xs font-medium text-muted">Item no.</label>
                        <input
                          value={item.itemNumber}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { itemNumber: e.target.value })}
                          className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm doc-id"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted">Activity</label>
                        <input
                          value={item.activity}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { activity: e.target.value })}
                          className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="block text-xs font-medium text-muted">Acceptance criteria</label>
                      <textarea
                        value={item.acceptanceCriteria}
                        onChange={(e) => updateItem(sectionIdx, itemIdx, { acceptanceCriteria: e.target.value })}
                        rows={2}
                        className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium text-muted">Reference (spec clause / standard)</label>
                        <input
                          value={item.referenceSpec}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { referenceSpec: e.target.value })}
                          className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted">Discipline</label>
                        <select
                          value={item.disciplineCode ?? ""}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { disciplineCode: e.target.value || null })}
                          className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
                        >
                          <option value="">No discipline</option>
                          {disciplines.map((d) => (
                            <option key={d.code} value={d.code}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium text-muted">Method (e.g. Megger test)</label>
                        <input
                          value={item.method}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { method: e.target.value })}
                          className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted">Frequency (e.g. Each circuit)</label>
                        <input
                          value={item.frequency}
                          onChange={(e) => updateItem(sectionIdx, itemIdx, { frequency: e.target.value })}
                          className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-xs"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="block text-xs font-medium text-muted">Evidence type</label>
                      <select
                        value={item.evidenceType}
                        onChange={(e) => updateItem(sectionIdx, itemIdx, { evidenceType: Number(e.target.value) as 1 | 2 | 3 })}
                        className="mt-1 w-full max-w-xs rounded border border-border bg-surface px-2 py-1.5 text-xs"
                      >
                        <option value={1}>Checklist</option>
                        <option value={2}>Document upload</option>
                        <option value={3}>Measurement record</option>
                      </select>
                    </div>

                    {item.suggestedInterventions.length > 0 && (
                      <div className="mt-3 rounded-md bg-off-white p-2">
                        <p className="text-xs font-medium text-muted">Suggested intervention levels</p>
                        <ul className="mt-1 space-y-1 text-xs text-muted">
                          {item.suggestedInterventions.map((si, siIdx) => {
                            const party = projectParties.find((p) => p.id === si.projectPartyId);
                            return (
                              <li key={siIdx}>
                                <span className="font-medium text-ink">{party?.name ?? "Unknown party"}</span>:{" "}
                                <span className="font-medium text-burgundy">{INTERVENTION_LABEL[si.intervention] ?? si.intervention}</span> —{" "}
                                {si.reason}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {item.disciplineCode && !disciplineNameByCode.has(item.disciplineCode) && (
                      <p className="mt-2 text-xs text-warning">
                        Unrecognised discipline code &quot;{item.disciplineCode}&quot; — pick one from the list above.
                      </p>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => addItem(sectionIdx)}
                  className="w-full rounded-md border border-dashed border-border py-2 text-xs font-medium text-muted hover:border-burgundy hover:text-burgundy"
                >
                  + Add activity to this section
                </button>
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
